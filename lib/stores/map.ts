import * as I from '../interfaces'
import err from '../err'
import {queryTypes} from '../qrtypes'
import iterGuard from '../iterGuard'
import {vRangeTo} from '../version'

const supportedOpTypes = new Set(['rm', 'set'])

export type MapFn<In, Out> = (v: In, k: I.Key | null, version: I.FullVersion) => Out

const mapValues = <K, In, Out>(map: Map<K, In>, fn: (v: In, k: K) => Out): Map<K, Out> => {
  const result = new Map<K, Out>()
  for (const [key, val] of map.entries()) {
    result.set(key, fn(val, key))
  }
  return result
}

const mapSingleOp = <In, Out>(op: I.SingleOp<In>, key: I.Key | null, version: I.FullVersion, fn: MapFn<In, Out>): I.SingleOp<Out> => {
  switch (op.type) {
    case 'rm': return op as I.SingleOp<any> as I.SingleOp<Out>
    case 'set': return {type: 'set', data: fn(op.data, key, version)}
    default: throw Error('Map function cannot process operation with type ' + op.type)
  }
}

const mapTxnWithMetas = <In, Out>(type: I.ResultOps<In, any, I.Txn<In>>, txn: I.TxnWithMeta<In>[], fn: MapFn<In, Out>): I.TxnWithMeta<Out>[] => (
  txn.map(({versions, txn, meta}) => ({
    txn: type.mapTxn(txn, (op: I.Op<In>, k) => (
      Array.isArray(op)
        ? op.map(singleOp => mapSingleOp(singleOp, k, versions, fn))
        : mapSingleOp(op, k, versions, fn)
    )),
    versions,
    meta,
  }))
)

export interface MapOpts {
  fnUid?: string, // This is a UID that should change each time the function is edited.
}

// Syncronous map fn
const map = <In, Out>(inner: I.Store<In>, mapfn: MapFn<In, Out>, opts: MapOpts = {}): I.Store<Out> => {
  const sources = inner.storeInfo.sources
  return {
    storeInfo: {
      uid: `map(${inner.storeInfo.uid},${opts.fnUid || '_'})`,
      sources,

      capabilities: {
        // TODO: Filter these capabilities by the ones we support locally.
        queryTypes: inner.storeInfo.capabilities.queryTypes,
        mutationTypes: new Set(), // You cannot mutate through the mapping.
      },
    },

    async fetch(query, opts) {
      const qtype = queryTypes[query.type]
      if (qtype == null) throw Error('unknown query type')

      const innerResults = await inner.fetch(query, opts)

      const version = vRangeTo(innerResults.versions)
      const outerResults: I.FetchResults<Out> = {
        // In the noDocs case, inner.fetch will have already stripped the documents.
        results: (opts && opts.noDocs)
          ? innerResults.results
          : qtype.resultType.map(innerResults.results, (v, k) => mapfn(v as In, k, version)),
        bakedQuery: innerResults.bakedQuery,
        versions: innerResults.versions,
      }

      return outerResults
    },

    mutate(mtype, txn, versions, opts) {
      return Promise.reject(new err.UnsupportedTypeError('You cannot modify through a map fn'))
    },

    async getOps(query, versions, opts): Promise<I.GetOpsResult> {
      const r = await inner.getOps(query, versions, {
        ...opts,
        supportedTypes: supportedOpTypes,
      })

      return {
        ops: mapTxnWithMetas(queryTypes[query.type].resultType, r.ops, mapfn),
        versions: r.versions,
      }
    },

    // TODO: catchup.

    subscribe(q, opts) {
      const qtype = queryTypes[q.type]

      const innerSub = inner.subscribe(q, {
        ...opts,
        supportedTypes: supportedOpTypes,
        trackValues: true,
      })

      const version: I.FullVersion = []

      return iterGuard((async function*() {
        for await (const innerUpdates of innerSub) {
          // Note that version contains the version *after* the whole catchup
          // is applied. I'm updating it here, but note that it is not used by
          // txns.
          for (let i = 0; i < sources.length; i++) {
            if (innerUpdates.toVersion[i] != null) version[i] = innerUpdates.toVersion[i]
          }

          // TODO: It'd be better to avoid calling the map function so often
          // here. We should really only call it at most once per object per
          // iteration.
          const result = {
            ...innerUpdates,
            txns: mapTxnWithMetas(qtype.resultType, innerUpdates.txns, mapfn),
            replace: innerUpdates.replace ? {
              q: innerUpdates.replace.q,
              with: qtype.resultType.mapReplace(innerUpdates.replace.with, (v: In, k) => mapfn(v, k, version)),
              versions: innerUpdates.replace.versions,
            } : undefined,
          }
          // console.log('map yield', result)

          yield result
        }
      })(), innerSub.return) as I.AsyncIterableIteratorWithRet<I.CatchupData<Out>>
    },

    close() {},
  }
}

export default map
