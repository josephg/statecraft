import * as I from '../types/interfaces'
import err from '../err'
import {queryTypes} from '../types/queryops'

const supportedOpTypes = new Set(['rm', 'set'])

export type MapFn = (v: I.Val, k: I.Key | null, version: I.FullVersion) => I.Val

const mapValues = <K, V1, V2>(map: Map<K, V1>, fn: (v: V1, k: K) => V2): Map<K, V2> => {
  const result = new Map<K, V2>()
  for (const [key, val] of map.entries()) {
    result.set(key, fn(val, key))
  }
  return result
}

const mapSingleOp = (op: I.SingleOp, key: I.Key | null, version: I.FullVersion, fn: MapFn) => {
  switch (op.type) {
    case 'rm': return op
    case 'set': return {type: 'set', data: fn(op.data, key, version)}
    default: throw Error('Map function cannot process operation with type ' + op.type)
  }
}

const mapOp = (op: I.Op, key: I.Key | null, version: I.FullVersion, fn: MapFn) => (
  Array.isArray(op)
    ? op.map(singleOp => mapSingleOp(singleOp, key, version, fn))
    : mapSingleOp(op, key, version, fn)
)

const mapTxn = (txn: I.Txn, version: I.FullVersion, fn: MapFn) => {
  return (txn instanceof Map)
    ? mapValues(txn, (op, key) => mapOp(op, key, version, fn))
    : mapOp(txn, null, version, fn)
}

const mapTxnWithMetas = (txn: I.TxnWithMeta[], fn: MapFn) => (
  txn.map(({versions, txn, uid}) => ({
    txn: mapTxn(txn, versions, fn),
    versions,
    uid,
  }))
)

const resultingVersion = (v: I.FullVersionRange): I.FullVersion => {
  const result: I.FullVersion = {}
  for (const s in v) result[s] = v[s].to
  return result
}

// Syncronous map fn
const map = (inner: I.Store, mapfn: MapFn): I.Store => {
  return {
    storeInfo: {
      sources: inner.storeInfo.sources,

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

      const version = resultingVersion(innerResults.versions)
      const outerResults: I.FetchResults = {
        // In the noDocs case, inner.fetch will have already stripped the documents.
        results: (opts && opts.noDocs)
          ? innerResults.results
          : qtype.r.map(innerResults.results, (v, k) => mapfn(v, k, version)),
        queryRun: innerResults.queryRun,
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
        ops: mapTxnWithMetas(r.ops, mapfn),
        versions: r.versions,
      }
    },

    subscribe(q, opts) {
      const qtype = queryTypes[q.type]

      const innerSub = inner.subscribe(q, {
        ...opts,
        supportedTypes: supportedOpTypes,
      })

      const version: I.FullVersion = {}

      return {
        ...innerSub,
        iter: (async function*() {
          for await (const innerUpdates of innerSub.iter) {
            // This is not completely correct - the replacement might be
            // replacing an earlier version of the document. Its possible the
            // map function will be called with a newer version than the
            // version the data actually is, if there's replace data *and*
            // txns.
            for (const s in innerUpdates.resultingVersions) {
              version[s] = innerUpdates.resultingVersions[s].to
            }

            yield {
              ...innerUpdates,
              replace: innerUpdates.replace ? {
                q: innerUpdates.replace.q,
                with: qtype.r.map(innerUpdates.replace.with, (v, k) => mapfn(v, k, version))
              } : undefined,
              txns: mapTxnWithMetas(innerUpdates.txns, mapfn)
            }
          }
        })() as I.AsyncIterableIteratorWithRet<I.CatchupData>
      }
    },

    close() {},
  }
}

export default map
