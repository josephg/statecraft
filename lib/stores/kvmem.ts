// This is a simple single value in-memory store.
import * as I from '../interfaces'
import genSource from '../gensource'
import err from '../err'
import resultMap from '../types/map'
import {queryTypes} from '../qrtypes'

import {findRangeStatic} from '../types/range'


const bakeSel = (sel: I.KeySelector, rawpos: number, resultpos: number, keys: ArrayLike<I.Key>) => {
  const {k, offset, isAfter} = sel
  const keylen = keys.length

  if (rawpos === resultpos) {
    // We can keep the selector as-is.
    return {k, isAfter}
  } else {
    return resultpos >= keylen ? {k: keys[keylen - 1], isAfter: true}
      : {k: keys[resultpos], isAfter: false}
  }
}

const findRangeAndBake = (range: I.Range, keys: ArrayLike<I.Key>): [number, number, I.StaticRange] => {
  const {from, to, limit, reverse} = range

  const [sposraw, eposraw] = findRangeStatic(range as I.StaticRange, keys)

  let spos = sposraw + range.from.offset
  let epos = eposraw + range.to.offset

  const l = limit || 0
  if (l > 0) {
    if (reverse) {
      spos = Math.max(spos, epos - l)
    } else {
      epos = Math.min(epos, spos + l)
    }
  }

  return [spos, epos, {
    from: bakeSel(from, sposraw, spos, keys),
    to: bakeSel(to, eposraw, epos, keys),
    reverse,
  }]
}

const capabilities = {
  queryTypes: new Set<I.QueryType>(['allkv', 'kv', 'static range', 'range']),
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
      let bakedQuery: I.Query | undefined
      const tag = (k: I.Key) => {
        const v = lastModVersion.get(k)
        if (v !== undefined) lowerRange = Math.max(lowerRange, v)
      }

      switch (query.type) {
        case 'kv':
          results = resultMap.filter(data, query.q)
          for (const k of query.q) tag(k)
          break

        case 'allkv':
          results = new Map(data)
          lowerRange = version
          break

        case 'static range':
        case 'range': {
          const q = query.q as I.RangeQuery
          results = [] as I.RangeResult

          // We're going to modify this to the baked range info.
          // Baked range info has no limit and no key offsets.
          if (query.type === 'range') bakedQuery = {type: 'static range', q: q.slice()}

          // This is expensive, but ... kvmem was never designed for large
          // data sets. Could refactor kvmem to use a btree or something
          // internally if it becomes a legitimate issue for anyone. Or just
          // make a fancier in memory store.
          const keys = Array.from(data.keys()).sort()

          for (let i = 0; i < q.length; i++) {
            const qc = q[i]
            let from: number, to: number
            if (query.type === 'range') {
              [from, to, (bakedQuery!.q as I.StaticRangeQuery)[i]] = findRangeAndBake(qc, keys)
            } else {
              [from, to] = findRangeStatic(qc, keys)
            }
            const vals = keys.slice(from, to).map(k => {
              // This is a bit sneaky.
              tag(k)
              return ([k, data.get(k)] as I.KVPair)
            })
            results.push(qc.reverse ? vals.reverse() : vals)
          }
          break
        }
        default:
          return Promise.reject(new err.UnsupportedTypeError())
      }

      // const results = qtype === 'allkv' ? new Map(data) : resultMap.filter(data, query)

      return Promise.resolve({
        // this is a bit inefficient.... ehhhh
        bakedQuery,
        results: opts.noDocs ? queryTypes[query.type].resultType.map(results, () => true) : results,
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
