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
import opmem from './opmem'
import Set2 from 'set2'

type MaybePromise<Val> = Val | Promise<Val>
interface TxnLike<Val> {
  get(k: I.Key): MaybePromise<Val>
}

export type Ctx = {txn: TxnLike<any>, Post?: any, Author?: any}

export interface MapReduce<Out> {
  // TODO: Also allow mapping from a synthetic set
  type: string, // eg Post
  queryStr: string,
  _doc?: gql.DocumentNode,
  // outPrefix: string,
  getOutputKey: (k: string, result: any) => string
  reduce: (result: any) => Out
}
export interface GQLMROpts {
  schemaVer?: number,
  source?: string,

  schema: gql.GraphQLSchema,

  mapReduces: MapReduce<any>[],

  prefixForCollection: Map<string, string>,
}

// const rangeWithPrefix = (prefix: string): I.StaticRange => ({
//   low: sel(prefix, false),
//   high: sel(prefix + '\xff', true)
// })

// const stripPrefix = (key: string, prefix: string): string => {
//   if (key.indexOf(prefix) !== 0) throw Error('Key has invalid prefix')
//   return key.slice(prefix.length)
// }

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
  
  // Set of keys which were used to generate each item
  const deps = opts.mapReduces.map(() => new Map<I.Key, Set<I.Key>>())
  // Set of output keys generated using this input key. Set is [mr idx, input key].
  const usedBy = new Map<I.Key, Set2<number, I.Key>>()
  // We need to store these because the key depends on the content, and when a
  // document is deleted we need to figure out which outKey to remove.
  const keyFor = opts.mapReduces.map(() => new Map<I.Key, I.Key>())

  const initialValues = new Map<string, any>()

  const render = async (key: I.Key, mri: number): Promise<{outKey: string, result?: any}> => {
    const {type, _doc, reduce, getOutputKey} = opts.mapReduces[mri]
    const docsRead = new Set<I.Key>()
    const txn: TxnLike<any> = {
      get(key) {
        docsRead.add(key)
        return allDocs.get(key)
      }
    }
    const value = txn.get(key)
    console.log('render', key, value)
    if (value == null) {
      return {outKey: keyFor[mri].get(key)!, result: undefined}
    }
    
    const res = await gql.execute(opts.schema, _doc!, null, {txn, [type]: value})
    docsRead.delete(key) // This is implied.

    console.log('res data', res.data)
    const mapped = reduce(res.data)
    const outKey = getOutputKey(key, res.data)
    // const outKey = outPrefix + key

    // Remove old deps
    const oldDeps = deps[mri].get(key)
    console.log('oldDeps', deps[mri])
    console.log('usedBy', usedBy)
    if (oldDeps) for (const k of oldDeps) {
      usedBy.get(k)!.delete(mri, key)
    }

    docsRead.forEach(k => {
      // if (k === key) return // This is implied.
      let s = usedBy.get(k)
      if (s == null) {
        s = new Set2()
        usedBy.set(k, s)
      }
      s.add(mri, key)
    })

    deps[mri].set(key, docsRead)
    keyFor[mri].set(key, outKey)
    console.log('kv', key, docsRead, mapped)
    return {outKey, result: mapped}
  }

  // await Promise.all(opts.mapReduces.map(async ({type, getOutputKey}, i) => {
  //   const prefix = opts.prefixForCollection.get(type)!
  //   for (const [key, value] of allDocs) if (key.startsWith(prefix)) {
  //     const {outKey, result} = await render(key, i)
  //     initialValues.set(outKey, result)
  //   }
  // }))

  console.log('deps', deps)
  console.log('usedBy', usedBy)

  // The frontend store which clients can query. TODO: Make this configurable.
  // There should also be no problem using multiple sources here.
  const beSource = backend.storeInfo.sources[0]
  const frontOps = opmem({source: beSource, initialVersion: results.versions[0]!.to})
  const frontend = await kvMem(initialValues, {
    inner: frontOps,
    readonly: true,
  })

  const sub = backend.subscribe({type: 'allkv', q: true}, {
    fromVersion: vRangeTo(results.versions),
    supportedTypes: new Set(['rm', 'set']),
  })
  ;(async () => {
    console.log('sub listening')
    const keys = new Set<string>()
    for await (const {replace, txns, toVersion} of sub) {
      // console.log('gqlmr results', replace, txns)
      const toUpdate = new Set2<number, I.Key>()

      const changed = (k: I.Key, v: any | null) => {
        console.log('changed', k, v)
        if (v == null) allDocs.delete(k)
        else allDocs.set(k, v)

        // We need to update:
        // - All map-reduces which include k in their primary set
        // - Everything that depends on k
        for (let i = 0; i < opts.mapReduces.length; i++) {
          const mr = opts.mapReduces[i]
          const prefix = opts.prefixForCollection.get(mr.type)!
          if (k.startsWith(prefix)) toUpdate.add(i, k)
        }

        // And the things that depend on us...
        const used = usedBy.get(k)
        if (used) {
          for (const [mri, k2] of used) toUpdate.add(mri, k2)
          used.clear()
        }
      }

      // TODO: Probably pull this out into a kv-specific helper function.
      if (replace) {
        for (const k of replace.q.q as Set<I.Key>) {
          const v = replace.with.get(k)
          changed(k, v)
        }
      }
      for (const _txn of txns) {
        const txn = _txn.txn as I.KVTxn<any>
        txn.forEach((op, k) => changed(k, (op as I.SingleOp<any>).type === 'set' ? (op as I.SingleOp<any>).data : undefined))
      }

      // console.log('toupdate', toUpdate)
      const txn = new Map<I.Key, I.Op<any>>()
      for (const [mri, k] of toUpdate) {
        const mr = opts.mapReduces[mri] //opts.mapReduces.find(mr => k.startsWith(mr.outPrefix))!
        const {outKey, result} = await render(k, mri)
        if (result === undefined) txn.set(outKey, {type: 'rm'})
        else txn.set(outKey, {type: 'set', data: result})
      }
      
      // console.log('usedby', usedBy)
      if (txn.size) {
        // console.log('gqlmr txn', txn)
        frontOps.internalDidChange('kv', txn, {}, toVersion[0]!)
      }
      // This is janky because we aren't handing versions correctly. We should
      // validate that the version >= the sub version in this txn result.
    }
  })()

  return augment(frontend)
}

export default gqlmr
