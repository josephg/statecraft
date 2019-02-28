// This implements a graphql based mapreduce store.
import * as I from '../interfaces'
import * as gql from 'graphql'
import * as gqlTools from 'graphql-tools'
import genSource from '../gensource'
import doTxn, {Transaction} from '../transaction'
import {vRangeTo} from '../version'
import subValues, { subResults } from '../subvalues'

import kvMem from './kvmem'
import augment from '../augment'
import sel from '../sel'
import opmem from './opmem';

type MaybePromise<Val> = Val | Promise<Val>
interface TxnLike<Val> {
  get(k: I.Key): MaybePromise<Val>
}

type Ctx = {txn: TxnLike<any>, Post?: any, Author?: any}
const schema = gqlTools.makeExecutableSchema({
  typeDefs: `
    type Post {
      title: String,
      content: String,
      author: Author,
    }

    type Author {
      fullName: String,
    }

    type Query {
      postById(id: String!): Post
      foo: String,

      selfPost: Post,
      selfAuthor: Author,
    }
  `,
  resolvers: {
    Post: {
      author: (post, args, {txn}: Ctx) => (
        txn.get('authors/' + post.author)
      )
    },

    Query: {
      postById: (_, {id}: {id: string}, {txn}: Ctx) => (
        txn.get('posts/' + id)
      ),

      selfPost: (_self, _args, {Post}) => Post,
    }
  }
})


export interface MapReduce<Out> {
  // TODO: Also allow mapping from a synthetic set
  type: string, // eg Post
  queryStr: string,
  _doc?: gql.DocumentNode,
  outPrefix: string,
  reduce: (result: any) => Out
}
export interface GQLMROpts {
  schemaVer?: number,
  source?: string,

  schema: gql.GraphQLSchema,

  mapReduces: MapReduce<any>[],

  prefixForCollection: Map<string, string>,
}

const rangeWithPrefix = (prefix: string): I.StaticRange => ({
  low: sel(prefix, false),
  high: sel(prefix + '\xff', true)
})

const stripPrefix = (key: string, prefix: string): string => {
  if (key.indexOf(prefix) !== 0) throw Error('Key has invalid prefix')
  return key.slice(prefix.length)
}

const gqlmr = async (backend: I.Store<any>, opts: GQLMROpts): Promise<I.Store<any>> => {
  const schemaVer = opts.schemaVer || 0
  const source = opts.source || genSource()

  opts.mapReduces.forEach(m => {
    if (m._doc == null) m._doc = gql.parse(m.queryStr)
  })

  // Slurp up everything in the underlying store
  
  // This is awful - its pulling everything into memory. But it should be
  // correct at least, as a POC.
  const results = await backend.fetch({type: 'allkv', q:true})
  console.log(results)

  // This just straight out contains the entire backend. bleh.
  const allDocs: Map<I.Key, any> = results.results

  
  // Set of keys which were used to generate this output key
  const deps = new Map<I.Key, Set<I.Key>>()
  // Set of output keys generated using this input key
  const usedBy = new Map<I.Key, Set<I.Key>>()

  const initialValues = new Map<string, any>()

  const render = async (key: I.Key, {type, _doc, outPrefix, reduce}: MapReduce<any>): Promise<any> => {
    const docsRead = new Set<I.Key>()
    const txn: TxnLike<any> = {
      get(key) {
        docsRead.add(key)
        return allDocs.get(key)
      }
    }
    const value = txn.get(key)
    const res = await gql.execute(schema, _doc!, null, {txn, [type]: value})

    const mapped = reduce(res.data)
    const outKey = outPrefix + key

    // Remove old deps
    const oldDeps = deps.get(key)
    if (oldDeps) for (const k of oldDeps) {
      usedBy.get(k)!.delete(key)
    }

    docsRead.forEach(k => {
      let s = usedBy.get(k)
      if (s == null) {
        s = new Set()
        usedBy.set(k, s)
      }
      s.add(outKey)
    })

    deps.set(outKey, docsRead)
    console.log('kv', key, docsRead, mapped)
    return mapped
  }

  await Promise.all(opts.mapReduces.map(async (mr, i) => {
    const prefix = opts.prefixForCollection.get(mr.type)!
    for (const [key, value] of allDocs) if (key.startsWith(prefix)) {
      const rendered = await render(key, mr)
      initialValues.set(mr.outPrefix + key, rendered)
    }
  }))

  console.log('deps', deps)
  console.log('usedBy', usedBy)

  // The frontend store which clients can query. TODO: Make this configurable.
  // There should also be no problem using multiple sources here.
  const beSource = backend.storeInfo.sources[0]
  const frontOps = opmem({source: beSource, initialVersion: results.versions[beSource].to})
  const frontend = await kvMem(initialValues, {
    inner: frontOps,
    readonly: true,
  })

  const sub = backend.subscribe({type: 'allkv', q: true}, {fromVersion: vRangeTo(results.versions)})
  ;(async () => {
    for await (const {results, versions} of subResults('kv', sub)) {
      const toUpdate = new Set()
      for (const [k, v] of results) {
        allDocs.set(k, v)
        const used = usedBy.get(k)
        if (used) {
          for (const k2 of used) toUpdate.add(k2)
          used.clear()
        }
      }

      console.log('toupdate', toUpdate)
      const txn = new Map<I.Key, I.Op<any>>()
      for (const k of toUpdate) {
        const mr = opts.mapReduces.find(mr => k.startsWith(mr.outPrefix))!
        const rendered = await render(stripPrefix(k, mr.outPrefix), mr)
        txn.set(k, {type: 'set', data: rendered})
      }

      if (txn.size) {
        frontOps.internalDidChange('kv', txn, {}, versions[beSource].to)
      }
      // This is janky because we aren't handing versions correctly. We should
      // validate that the version >= the sub version in this txn result.
    }
  })()

  return augment(frontend)
}

export default gqlmr



process.on('unhandledRejection', err => { throw err })

;(async () => {
  const backend = augment(await kvMem(new Map<string, any>([
    ['authors/auth', {fullName: 'Seph'}],
    ['posts/post1', {title: 'Yo', content: 'omg I am clever', author: 'auth'}],
  ])))

  const store = await gqlmr(backend, {
    schema,
    mapReduces: [
      {
        type: 'Post',
        queryStr: `{selfPost {title, author {fullName}}}`,
        reduce: x => x.selfPost,
        outPrefix: 'pr/'
      }
    ],
    prefixForCollection: new Map([
      ['Post', 'posts/'],
      ['Author', 'authors/'],
    ]),
  })

  ;(async () => {
    const sub = store.subscribe({type: 'allkv', q:true})
    for await (const upd of subValues('kv', sub)) {
      console.log('sub', upd)
    }
  })()

  // const v = await store.fetch({type: 'allkv', q:true})
  // console.log('v results', v.results)

  await new Promise(resolve => setTimeout(resolve, 500))
  await backend.mutate('kv', new Map([['authors/auth', {type: 'set', data:{fullName: 'rob'}}]]))

})()