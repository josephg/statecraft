// This is a simple single value in-memory store.
import * as I from '../interfaces'
import genSource from '../gensource'
import err from '../err'
import resultMap from '../types/map'
import {queryTypes} from '../querytypes'
import binsearch from 'binary-search'


// const mapValueMapMut = <K>(map: Map<K, any>, f: (v: any, k: K) => any): Map<K, any> => {
//   for (const [k, v] of map) map.set(k, f(v, k))
//   return map
// }

const cmp = <T>(a: T, b: T) => a < b ? -1 : a > b ? 1 : 0
const findRange = (range: I.Range, keys: ArrayLike<I.Key>): [number, number] | null => {
  // This is expensive, but ... kvmem was never designed for large
  // data sets. Could refactor kvmem to use a btree or something
  // internally if it becomes a legitimate issue for anyone. Or just
  // make a fancier in memory store.

  // Figure out the index of the start of the range we want
  let pos = binsearch(keys, range.from.k, cmp)

  let startIdx = Math.max(0, (pos < 0
    ? -pos-1
    : range.from.isAfter ? pos+1 : pos
  ) + range.from.offset)

  if (startIdx >= keys.length) return null
  
  // Now the end of the range
  pos = binsearch(keys, range.to.k, cmp, startIdx)

  // This is the index of the next element past the desired range
  let endIdx = Math.min(keys.length, (pos < 0
    ? -pos-1
    : range.to.isAfter ? pos+1 : pos
  ) + range.to.offset)
  if (endIdx < 0) return null

  if (range.limit != null) {
    if (range.reverse) {
      startIdx = Math.max(startIdx, endIdx - range.limit)
    } else {
      endIdx = Math.min(endIdx, startIdx + range.limit)
    }
  }

  return [startIdx, endIdx]
}

const capabilities = {
  queryTypes: new Set<I.QueryType>(['allkv', 'kv', 'range']),
  mutationTypes: new Set<I.ResultType>(['kv']),
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
  internalDidChange(txn: I.KVTxn, meta: I.Metadata, preApplied?: boolean): I.Version
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

      let results: Map<I.Key, I.Val> | I.RangeResult
      let lowerRange: I.Version = initialVersion
      let queryRun = query

      switch (query.type) {
        case 'kv':
          results = resultMap.filter(data, query.q)
          for (const k of query.q) {
            const v = lastModVersion.get(k)
            if (v !== undefined) lowerRange = Math.max(lowerRange, v)
          }
          break

        case 'allkv':
          results = new Map(data)
          break

        case 'range': {
          const q = query.q as I.RangeQuery
          results = [] as I.RangeResult

          // We're going to modify this to the baked range info.
          // Baked range info has no limit and no key offsets.
          queryRun = {type: 'range', q: q.slice()}

          // This is expensive, but ... kvmem was never designed for large
          // data sets. Could refactor kvmem to use a btree or something
          // internally if it becomes a legitimate issue for anyone. Or just
          // make a fancier in memory store.
          const keys = Array.from(data.keys()).sort()

          for (let i = 0; i < q.length; i++) {
            const qc = q[i]
            const qrc = queryRun.q[i] = {...qc, limit: 0}

            const r = findRange(qc, keys)
            if (r == null) {
              results.push([])
              qrc.from = qrc.to = {k: '', isAfter: false, offset: 0}
            } else {
              const vals = keys.slice(r[0], r[1]).map(
                k => ([k, data.get(k)] as I.KVPair)
              )
              results.push(qc.reverse ? vals.reverse() : vals)

              // I'm really unhappy with this. At the very least I could relax
              // the bounds a little so it'll only chomp in if the limit was
              // actually hit.
              if ((qc.limit && qc.reverse) || qc.from.offset) {
                qrc.from = {k: keys[r[0]], isAfter: false, offset: 0}
              }
              if ((qc.limit && !qc.reverse) || qc.to.offset) {
                qrc.to = {k: keys[r[1]-1], isAfter: true, offset: 0}
              }
            }

          }
          break
        }
        default:
          return Promise.reject(new err.UnsupportedTypeError())
      }

      // const results = qtype === 'allkv' ? new Map(data) : resultMap.filter(data, query)

      return Promise.resolve({
        // this is a bit inefficient.... ehhhh
        results: opts.noDocs ? queryTypes[query.type].resultType.map(results, () => true) : results,
        queryRun,
        versions: {[source]: {from:lowerRange, to:version}},
      })
    },

    internalDidChange(txn, meta, preapplied = false) {
      const fromv = version
      const opv = ++version

      for (const [k, op] of txn) lastModVersion.set(k, opv)
      if (!preapplied) resultMap.applyMut!(data, txn)

      if (this.onTxn != null) this.onTxn(source, fromv, opv, 'kv', txn, data, meta)
      return opv
    },

    mutate(type, _txn, versions, opts = {}) {
      if (type !== 'kv') return Promise.reject(new err.UnsupportedTypeError())
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
      const opv = this.internalDidChange(txn, opts.meta || {}, false)
      return Promise.resolve({[source]: opv})
    },

    close() {},
  }
  return store
}
