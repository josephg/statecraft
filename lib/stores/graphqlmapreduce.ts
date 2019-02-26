// This implements a graphql based mapreduce store.
import * as I from '../interfaces'
import * as gql from 'graphql'
import * as gqlTools from 'graphql-tools'
import genSource from '../gensource'
import doTxn, {Transaction} from '../transaction'

import kvMem from './kvmem'
import augment from '../augment'
import sel from '../sel'

type Ctx = {txn: Transaction, Post?: any, Author?: any}
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
      author(post, args, {txn}: Ctx) {
        return txn.get('authors/' + post.author)
      }
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
  
  // TODO: This should use cursors and blah blah blah. This implementation is awful.
  const query: I.StaticRangeQuery = opts.mapReduces.map(({type}) => type)
  .map(type => opts.prefixForCollection.get(type)!)
  .map(rangeWithPrefix)

  const results = await backend.fetch({type: 'static range', q:query})
  console.log(results)
  
  const initialValues = new Map<string, any>()
  await Promise.all(opts.mapReduces.map(async ({type, _doc, reduce}, i) => {
    const docs = results.results[i]
    const prefix = opts.prefixForCollection.get(type)
    for (const [key, value] of docs) {
      const res = await doTxn(backend, async txn => (
        await gql.execute(schema, _doc!, null, {txn, [type]: value})
      ))
      const mapped = reduce(res.results.data)
      initialValues.set(key, mapped)
      console.log('kv', key, value, mapped)
    }
  }))

  // The frontend store which clients can query. TODO: Make this configurable.
  const frontend = kvMem(initialValues, {
    source: backend.storeInfo.sources[0],
    initialVersion: results.versions[backend.storeInfo.sources[0]].to,
    readonly: true
  })


  return augment(frontend)
}

export default gqlmr



const backend = augment(kvMem(new Map<string, any>([
  ['authors/auth', {fullName: 'Seph'}],
  ['posts/post1', {title: 'Yo', content: 'omg I am clever', author: 'auth'}],
])))



process.on('unhandledRejection', err => { throw err })

;(async () => {
  const store = await gqlmr(backend, {
    schema,
    mapReduces: [
      {
        type: 'Post',
        queryStr: `{selfPost {title, author {fullName}}}`,
        reduce: x => x.selfPost,
      }
    ],
    prefixForCollection: new Map([
      ['Post', 'posts/'],
      ['Author', 'authors/'],
    ]),
  })

  const v = await store.fetch({type: 'allkv', q:true})
  console.log(v.results)
})()