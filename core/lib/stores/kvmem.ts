// This is a simple single value in-memory store. It wants to be backed by
// another store which holds all our operations.

import * as I from '../interfaces'
import err from '../err'
import resultMap from '../types/map'
import {queryTypes} from '../qrtypes'
import {vMax, V_EMPTY, vCmp, vEq, V64} from '../version'
import {findRangeStatic} from '../types/range'
import opmem from './opmem';
import { bitSet } from '../bit'
import makeSubGroup, {SubGroup} from '../subgroup'
import resolvablePromise, { Resolvable } from '@josephg/resolvable'


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
  queryTypes: bitSet(I.QueryType.AllKV, I.QueryType.KV, I.QueryType.StaticRange, I.QueryType.Range),
  mutationTypes: bitSet(I.ResultType.KV),
  // ops: <I.OpsSupport>'none',
}

export interface KVMemOptions<Val> {
  readonly?: boolean,
  // All fetches will hit our store. But all operations will go via the inner store.
  inner?: I.Store<Val>,
  fromVersion?: I.Version,
}

export default function createKVStore<Val>(
  _data?: Map<I.Key, Val>,
  storeOpts: KVMemOptions<Val> = {}
  // source: I.Source = genSource(),
  // initialVersion: I.Version = 0
): Promise<I.Store<Val>> {
  const inner = storeOpts.inner || opmem()
  const data: Map<I.Key, Val> = _data == null ? new Map() : _data
  const lastModVersion = new Map<I.Key, I.Version>()

  if (inner.storeInfo.sources.length !== 1) throw Error('Using an inner store with more than one source not currently supported')
  // const source = inner.storeInfo.sources[0]
  let lastVersion: I.Version = V_EMPTY

  let nextOpP = resolvablePromise()

  let closed = false

  let ready: Resolvable<void> = resolvablePromise()

  const fetch: I.FetchFn<Val> = async (query, opts = {}) => {
    if (ready) await ready
    // console.log('ready lv', lastVersion)

    // We can technically return anything if no minVersion is set.
    // Uncomment this for jerk mode where we do the minimum possible. Tests should still pass.
    // if (!opts.minVersion && !opts.atVersion && query.type === I.QueryType.KV) {
    //   return {results: new Map(), versions: [{from:V64(0), to:V64(0)}]}
    // }

    // console.log('fetch query', query)

    let results: Map<I.Key, Val> | I.RangeResult<Val>
    let lowerRange: Uint8Array = V64(0)//V_EMPTY
    let bakedQuery: I.Query | undefined
    const tag = (k: I.Key) => {
      const v = lastModVersion.get(k) || lastVersion
      lowerRange = vMax(lowerRange, v)
    }

    switch (query.type) {
      case I.QueryType.KV:
        results = resultMap.filter(data, query.q)
        for (const k of query.q) tag(k)
        break

      case I.QueryType.AllKV:
        results = new Map(data)
        lowerRange = lastVersion // Dodgy...
        break

      case I.QueryType.Range:
        bakedQuery = {type: I.QueryType.StaticRange, q: query.q.slice()}
      case I.QueryType.StaticRange: {
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
          if (query.type === I.QueryType.Range) {
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
      versions: [{from:lowerRange, to:lastVersion}],
    })
  }

  // Initialized by the time ready is resolves.
  let subgroup: SubGroup<Val> | null = null

  const store: I.Store<Val> = {
    storeInfo: {
      uid: `kvmem(${inner.storeInfo.uid})`,
      capabilities,
      sources: inner.storeInfo.sources,
    },

    fetch,

    // TODO: It would be better if opmem was query-blind. Consider wrapping this and trim operations here.
    getOps: inner.getOps.bind(inner),

    subscribe(q, opts) { return subgroup!.create(q, opts) },

    async mutate(type, _txn, versions = [], opts = {}) {
      if (type !== I.ResultType.KV) throw new err.UnsupportedTypeError()
      if (storeOpts.readonly) throw new err.AccessDeniedError()

      const txn = _txn as I.KVTxn<Val>

      let reqV = versions[0]
      // let v = reqV == null ? lastVersion : reqV

      while (true) {
        // 1. Preflight. Check versions and (ideally) that the operations are valid.
        if (reqV != null && vCmp(reqV, lastVersion) < 0) {
          for (const [k, op] of txn) {
            const lastModV = lastModVersion.get(k)
            if (lastModV !== undefined && vCmp(reqV, lastModV) < 0) return Promise.reject(new err.WriteConflictError())

            // TODO: Also check that the operation is valid for the given document,
            // if the OT type supports it.
          }
          reqV = lastVersion
        }

        // 2. Actually apply.
        try {
          const v = await inner.mutate(type, txn, reqV == null ? [] : [reqV], opts)
          // Don't return until we'll read your writes. This is a bit hacky - its correct,
          // but I'd rather solve this by getting the consumer to pass a min version option to fetch.
          while (vCmp(lastVersion, v[0]!) < 0) {
            // console.log('mutate wait', v[0], lastVersion)
            await nextOpP
            // console.log('ok', v[0], lastVersion)
          }
          return v
        } catch (e) {
          if (reqV == null || !(e instanceof err.VersionTooOldError)) throw e
          // Otherwise keep looping.
          console.warn(e)
        }
        
        // 3. Wait for another operation to be applied locally before retrying.
        if (vEq(reqV, lastVersion)) await nextOpP
      }
    },

    close() {
      closed = true
      if (storeOpts.inner == null) inner.close()
    },
  }

  const sub = inner.subscribe({type: I.QueryType.AllKV, q: true}, {
    fromVersion: [storeOpts.fromVersion || V_EMPTY]
  })
  ;(async () => {
    for await (const cu of sub) {
      // console.log('cu', cu, closed)
      if (closed) break

      // We should be able to handle this actually.
      if (cu.replace) throw new Error('Unexpected replace data in catchup')
      
      const toV = cu.toVersion[0]
      
      for (let i = 0; i < cu.txns.length; i++) {
        const txn = cu.txns[i].txn as I.KVTxn<Val>
        for (const [k, op] of txn) lastModVersion.set(k, toV!)
        resultMap.applyMut!(data, txn)
      }
      
      if (subgroup == null) subgroup = makeSubGroup({
        initialVersion: cu.toVersion,
        fetch,
        getOps: inner.getOps.bind(inner)
      })

      if (cu.txns.length) subgroup.onOp(0, lastVersion, cu.txns)
      if (toV != null) lastVersion = toV

      // console.log('rotate', lastVersion, cu)
      nextOpP.resolve()
      nextOpP = resolvablePromise<void>()

      if (cu.caughtUp) ready.resolve()
    }
  })()

  return ready.then(() => store)
}
