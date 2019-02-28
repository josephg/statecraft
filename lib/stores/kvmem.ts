// This is a simple single value in-memory store.
import * as I from '../interfaces'
import genSource from '../gensource'
import err from '../err'
import resultMap from '../types/map'
import {queryTypes} from '../qrtypes'
import {V64, v64ToNum, vMax, V_EMPTY, vCmp} from '../version'
import {findRangeStatic} from '../types/range'
import opmem from './opmem';


const bakeSel = (sel: I.KeySelector, rawpos: number, resultpos: number, keys: ArrayLike<I.Key>) => {
  const {k, offset, isAfter} = sel
  const keylen = keys.length

  if (rawpos === resultpos || keys.length === 0) {
    // We can keep the selector as-is.
    return {k, isAfter}
  } else {
    return resultpos >= keylen ? {k: keys[keylen - 1], isAfter: true}
      : resultpos < keylen ? {k: keys[0], isAfter: false}
      : {k: keys[resultpos], isAfter: false}
  }
}

const findRangeAndBake = (range: I.Range, keys: ArrayLike<I.Key>): [number, number, I.StaticRange] => {
  const {low, high, limit, reverse} = range

  const [sposraw, eposraw] = findRangeStatic(range as I.StaticRange, keys)

  let spos = sposraw + (range.low.offset || 0)
  let epos = eposraw + (range.high.offset || 0)

  const l = limit || 0
  if (l > 0) {
    if (reverse) {
      spos = Math.max(spos, epos - l)
    } else {
      epos = Math.min(epos, spos + l)
    }
  }

  return [spos, epos, {
    low: bakeSel(low, sposraw, spos, keys),
    high: bakeSel(high, eposraw, epos, keys),
    reverse,
  }]
}

const capabilities = {
  queryTypes: new Set<I.QueryType>(['allkv', 'kv', 'static range', 'range']),
  mutationTypes: new Set<I.ResultType>(['kv']),
  // ops: <I.OpsSupport>'none',
}

export interface KVMemOptions<Val> {
  readonly?: boolean,
  inner?: I.OpStore<Val>
}

export default async function singleStore<Val>(
  _data?: Map<I.Key, Val>,
  storeOpts: KVMemOptions<Val> = {}
  // source: I.Source = genSource(),
  // initialVersion: I.Version = 0
): Promise<I.SimpleStore<Val>> {
  const inner = storeOpts.inner || opmem()
  const data: Map<I.Key, Val> = _data == null ? new Map() : _data
  const lastModVersion = new Map<I.Key, I.Version>()

  // This is nasty.
  // const initialVersion = storeOpts.initialVersion ? v64ToNum(storeOpts.initialVersion) : 0

  if (inner.storeInfo.sources.length !== 1) throw Error('Using an inner store with more than one source not currently supported')
  const source = inner.storeInfo.sources[0]
  let lastVersion: I.Version | null = null

  const store: I.SimpleStore<Val> = {
    storeInfo: {
      capabilities,
      sources: inner.storeInfo.sources,
    },

    fetch(query, opts = {}) {
      // console.log('fetch query', JSON.stringify(query, null, 2))

      let results: Map<I.Key, Val> | I.RangeResult<Val>
      let lowerRange: Uint8Array = V_EMPTY
      let bakedQuery: I.Query | undefined
      const tag = (k: I.Key) => {
        const v = lastModVersion.get(k)
        if (v !== undefined) lowerRange = vMax(lowerRange, v)
      }

      switch (query.type) {
        case 'kv':
          results = resultMap.filter(data, query.q)
          for (const k of query.q) tag(k)
          break

        case 'allkv':
          results = new Map(data)
          lowerRange = lastVersion! // Dodgy...
          break

        case 'range':
          bakedQuery = {type: 'static range', q: query.q.slice()}
        case 'static range': {
          const q = query.q as I.RangeQuery
          results = [] as I.RangeResult<Val>

          // We're going to modify this to the baked range info.
          // Baked range info has no limit and no key offsets.

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
              return ([k, data.get(k)] as I.KVPair<Val>)
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
        versions: {[source]: {from:lowerRange, to:lastVersion!}},
      })
    },


    mutate(type, _txn, versions, opts = {}) {
      if (type !== 'kv') return Promise.reject(new err.UnsupportedTypeError())
      if (storeOpts.readonly) return Promise.reject(new err.AccessDeniedError())
      // console.log('kvmem mutate')

      const txn = _txn as I.KVTxn<Val>

      const expectv = (!versions || versions[source] == null) ? lastVersion! : versions[source]

      // These are both numbers here, so this comparison is ok.
      // if (expectv < initialVersion) return Promise.reject(new err.VersionTooOldError())

      // 1. Preflight. Check versions and (ideally) that the operations are valid.
      for (const [k, op] of txn) {
        const v = lastModVersion.get(k)
        if (v !== undefined && vCmp(expectv, v) < 0) return Promise.reject(new err.WriteConflictError())

        // TODO: Also check that the operation is valid for the given document,
        // if the OT type supports it.
      }

      // 2. Actually apply.
      return inner.mutate(type, txn, versions, opts)
    },

    close() {},
  }

  inner.onTxn = (source, fromV, toV, type, _txn, view, meta) => {
    if (type !== 'kv') throw new err.UnsupportedTypeError()
    lastVersion = toV
    const txn = _txn as I.KVTxn<Val>

    for (const [k, op] of txn) lastModVersion.set(k, toV)
    resultMap.applyMut!(data, txn)

    if (store.onTxn != null) store.onTxn(source, fromV, toV, 'kv', txn, data, meta)
  },

  // Should we await this?
  lastVersion = (await inner.start!())[source]
  return store
}
