// This is a simple single value in-memory store.
import * as I from '../types/interfaces'
import genSource from '../gensource'
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

  // Apply and notify that a change happened in the database. This is useful
  // so if the memory store wraps an object that is edited externally, you can
  // update listeners.
  internalDidChange(txn: I.KVTxn, uid?: string, preApplied?: boolean): I.Version
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
    storeInfo: {
      capabilities,
      sources: [source],
    },
    fetch(query, opts = {}) {
      // console.log('fetch query', query)
      if (query.type !== 'allkv' && query.type !== 'kv') return Promise.reject(new err.UnsupportedTypeError())

      let results: Map<I.Key, I.Val>
      let lowerRange: I.Version = initialVersion

      if (query.type === 'kv') {
        // kv query.
        results = resultMap.filter(data, query.q)
        for (const k of query.q) {
          const v = lastModVersion.get(k)
          if (v !== undefined) lowerRange = Math.max(lowerRange, v)
        }
      } else {
        // allkv.
        results = new Map(data)
      }
      // const results = qtype === 'allkv' ? new Map(data) : resultMap.filter(data, query)

      return Promise.resolve({
        // this is a bit inefficient.... ehhhh
        results: opts.noDocs ? mapValueMapMut(results, () => true) : results,
        queryRun: query,
        versions: {[source]: {from:lowerRange, to:version}},
      })
    },

    internalDidChange(txn, uid?: string, preapplied = false) {
      const fromv = version
      const opv = ++version

      for (const [k, op] of txn) lastModVersion.set(k, opv)
      if (!preapplied) resultMap.applyMut!(data, txn)

      if (this.onTxn != null) this.onTxn(source, fromv, opv, 'resultmap', txn, uid)
      return opv
    },

    mutate(type, _txn, versions, opts = {}) {
      if (type !== 'resultmap') return Promise.reject(new err.UnsupportedTypeError())
      if (storeOpts.readonly) return Promise.reject(new err.AccessDeniedError())

      const txn = _txn as I.KVTxn

      const expectv = (!versions || versions[source] == null) ? version : versions[source]
      if (expectv < initialVersion) return Promise.reject(new err.VersionTooOldError())

      // 1. Preflight. Check versions and (ideally) that the operations are valid.
      for (const [k, op] of txn) {
        const v = lastModVersion.get(k)
        if (v !== undefined && expectv < v) return Promise.reject(new err.WriteConflictError())

        // TODO: Also check that the operation is valid for the given document,
        // if the OT type supports it.
      }

      // 2. Actually apply.
      const opv = this.internalDidChange(txn, opts.uid, false)
      return Promise.resolve({[source]: opv})
    },

    close() {},
  }
  return store
}
