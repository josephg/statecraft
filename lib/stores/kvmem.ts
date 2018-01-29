// This is a simple single value in-memory store.
import * as I from '../types/interfaces'
import {genSource} from '../util'
import err from '../err'
import resultMap from '../types/resultmap'

// const mapValueMap = <K,X,Y>(map: Map<K, X>, f: (X, K) => Y): Map<K, Y> => {
//   const result = new Map
// }
const mapValueMapMut = <K>(map: Map<K, any>, f: (v: any, k: K) => any): Map<K, any> => {
  for (const [k, v] of map) map.set(k, f(v, k))
  return map
}

const capabilities = {
  queryTypes: new Set<I.QueryType>(['allkv', 'kv']),
  mutationTypes: new Set<I.ResultType>(['resultmap']),
  // ops: <I.OpsSupport>'none',
}

export interface KVMemOptions {
  initialVersion?: I.Version,
  source?: I.Source,
  readonly?: boolean,
}

export interface MemStore extends I.SimpleStore {
  // internalDidChange(type: I.ResultType, txn: I.Txn, versions: I.FullVersion, opts: I.MutateOptions): void

  // Apply and notify that a change happened in the database.
  internalDidChange(txn: I.KVTxn, preApplied?: boolean): I.Version
}

export default function singleStore(
    _data?: Map<I.Key, I.Val>,
    storeOpts: KVMemOptions = {}
    // source: I.Source = genSource(),
    // initialVersion: I.Version = 0
): MemStore {
  const data: Map<I.Key, I.Val> = _data == null ? new Map() : _data
  const lastModVersion = new Map<I.Key, I.Version>()

  const source = storeOpts.source || genSource()
  const initialVersion = storeOpts.initialVersion || 0

  let version: number = initialVersion

  const store: MemStore = {
    capabilities,
    sources: [source],
    fetch(qtype, query, opts, callback) {
      if (!capabilities.queryTypes.has(qtype)) return callback(new err.UnsupportedTypeError())

      let results: Map<I.Key, I.Val>
      let lowerRange: I.Version = initialVersion

      if (qtype === 'allkv') {
        // If its allkv, we should technically return an empty map or something.
        results = new Map(data)
      } else {
        // kv query.
        results = resultMap.filter(data, query)
        for (const k of query) {
          const v = lastModVersion.get(k)
          if (v !== undefined) lowerRange = Math.max(lowerRange, v)
        }
      }
      // const results = qtype === 'allkv' ? new Map(data) : resultMap.filter(data, query)

      callback(null, {
        results: opts.noDocs ? mapValueMapMut(results, () => true) : results,
        queryRun: query,
        versions: {[source]: {from:lowerRange, to:version}},
      })
    },

    internalDidChange(txn, preapplied = false) {
      const fromv = version
      const opv = ++version

      for (const [k, op] of txn) lastModVersion.set(k, opv)
      if (!preapplied) resultMap.applyMut!(data, txn)

      if (this.onTxn != null) this.onTxn(source, fromv, opv, 'resultmap', txn)
      return opv
    },

    mutate(type, _txn, versions, opts, callback) {
      if (type !== 'resultmap') return callback(new err.UnsupportedTypeError())
      if (storeOpts.readonly) return callback(new err.AccessDeniedError())

      const txn = _txn as I.KVTxn

      const expectv = versions[source] == null ? version : versions[source]
      if (expectv < initialVersion) return callback(new err.VersionTooOldError())

      // 1. Preflight. Check versions and (ideally) that the operations are valid.
      for (const [k, op] of txn) {
        const v = lastModVersion.get(k)
        if (v !== undefined && expectv < v) return callback(new err.WriteConflictError())

        // TODO: Also check that the operation is valid for the given document,
        // if the OT type supports it.
      }

      // 2. Actually apply.
      const opv = this.internalDidChange(txn, false)
      callback(null, {[source]: opv})
    },

    close() {},
  }
  return store
}
