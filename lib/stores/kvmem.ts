// This is a simple single value in-memory store.
import * as I from '../types/interfaces'
import {genSource} from '../util'
import * as err from '../err'
import resultMap from '../types/resultmap'


const capabilities = {
  queryTypes: new Set<I.QueryType>(['allkv', 'kv']),
  mutationTypes: new Set<I.ResultType>(['resultmap']),
  // ops: <I.OpsSupport>'none',
}

const singleStore = (data: Map<I.Key, I.Val> = new Map(),
    source: I.Source = genSource(),
    initialVersion: I.Version = 0
): I.SimpleStore => {
  const lastModVersion = new Map<I.Key, I.Version>()
  let version: number = initialVersion

  const store: I.SimpleStore = {
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
        results,
        queryRun: query,
        versions: {[source]: {from:lowerRange, to:version}},
      })
    },

    mutate(type, _txn, versions, opts, callback) {
      if (type !== 'resultmap') return callback(new err.UnsupportedTypeError())
      const txn = _txn as I.KVTxn

      const expectv = versions[source] || version
      if (expectv < initialVersion) return callback(new err.VersionTooOldError())

      // 1. Preflight. Check versions and (ideally) that the operations are valid.
      for (const [k, op] of txn) {
        const v = lastModVersion.get(k)
        if (v !== undefined && expectv < v) return callback(new err.VersionTooOldError())

        // TODO: Also check that the operation is valid for the given document,
        // if the OT type supports it.
      }

      // 2. Actually apply.
      const fromv = version
      const opv = ++version

      for (const [k, op] of txn) lastModVersion.set(k, opv)
      resultMap.applyMut!(data, txn)

      if (store.onTxn != null) store.onTxn(source, fromv, opv, type, txn)

      callback(null, {[source]: opv})
    },

    close() {},
  }
  return store
}

export default singleStore
