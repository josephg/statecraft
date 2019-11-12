// This implements the router - which lets you back different parts of a
// keyspace with a set of different stores. This code is really ugly and
// doesn't support range queries and a bunch of other stuff.

// This is a genuinely hard & interesting space, and this code is very much a
// first pass solution.

import * as I from '../interfaces'
import err from '../err'
import {queryTypes, resultTypes} from '../qrtypes'
import {vIntersectMut, vEq, vSparse} from '../version'
import sel from '../sel'
import {vMax, vMin, vCmp} from '../version'
import iterGuard from '../iterGuard'
import { bitSet } from '../bit'

import streamToIter from 'ministreamiterator'

// import {inspect} from 'util'
// const ins = (x: any) => inspect(x, {depth: null, colors: true})


const assert = (v: any, msg?: string) => {
  if (!v) throw Error('assertion failed: ' + msg)
}

// Selector utilities.
type Sel = I.StaticKeySelector

export type Router<Val> = I.Store<Val> & {
  mount<V2 extends Val>(store: I.Store<V2>, fPrefix: string, range: [Sel, Sel] | null, bPrefix: string, isOwned: boolean): void,
}

type RangeRes = {inputs: [number, number][], reverse: boolean}[]

type Route = {
  store: I.Store<any>,

  // This maps from backend source id to frontend source (eg sourceMap[0] = 4)
  sourceMap: number[],

  // Frontend prefix (eg movies/)
  fPrefix: string,
  // Frontend range (eg ['movies/m', 'movies/q']).
  fRange: [Sel, Sel],

  // Backend prefix (eg imdb/)
  bPrefix: string,

  // Are we the exclusive owner of the backend DB? Aka, when the router is
  // closed, should we chain close the backend?
  isOwned: boolean,
}

let nextId = 1000 // For debugging

export const prefixToRange = (prefix: string): [Sel, Sel] => [sel(prefix), sel(prefix+'~')]
export const ALL = prefixToRange('')

const changePrefix = (k: I.Key, fromPrefix: string, toPrefix: string) => {
  assert(k.startsWith(fromPrefix))
  return toPrefix + k.slice(fromPrefix.length)
}

const changeSelPrefix = (s: Sel, fromPrefix: string, toPrefix: string): Sel => {
  return sel(changePrefix(s.k, fromPrefix, toPrefix), s.isAfter)
}

// const mapKeysInto = <T>(dest: Map<I.Key, T> | null, oldMap: Map<I.Key, T> | null, keyRoutes: Map<I.Key, Route>) => {
//   if (dest == null) dest = new Map<I.Key, T>()
//   if (oldMap == null) return dest

//   const r = resultTypes['kv']

//   return r.copyInto!(dest, r.mapEntries(oldMap, (bk, v) => {
//     const route = keyRoutes.get(bk!)
//     return route == null ? null : [changePrefix(bk!, route.bPrefix, route.fPrefix), v]
//   }))
// }

// Convert frontend versions into backend versions for a particular route
const mapVersionsFrontToBack = <V>(versions: (V | null)[], sourceMap: number[]): (V | null)[] => (
  sourceMap.map(m => versions[m])
)

const mapVersionsBackToFront = <V>(versions: (V | null)[], sourceMap: number[]): (V | null)[] => {
  const result: (V | null)[] = []
  versions.forEach((v, i) => {result[sourceMap[i]] = v})
  return result
}

const mapKVResults = <T>(from: Map<I.Key, T>, routes: Map<I.Key, Route>): Map<I.Key, T> => (
  resultTypes[I.ResultType.KV].mapEntries(from, (bk, v) => {
    const route = (routes as Map<I.Key, Route>).get(bk!)
    return route == null ? null : [changePrefix(bk!, route.bPrefix, route.fPrefix), v]
  })
)

const mapRangeResults = <T>(from: [I.Key, T][][], routes: Route[]): [I.Key, T][][] => (
  from.map((rr, i) => {
    const route = (routes as Route[])[i]
    return rr.map(
      ([k, v]) => ([changePrefix(k, route.bPrefix, route.fPrefix), v] as I.KVPair<T>)
    )
  })
)

const mapResults = <T>(qtype: I.QueryType, from: Map<I.Key, T> | [I.Key, T][][], routes: Map<I.Key, Route> | Route[]) => (
  qtype === I.QueryType.KV
    ? mapKVResults(from as Map<I.Key, T>, routes as Map<I.Key, Route>)
    : mapRangeResults(from as [I.Key, T][][], routes as Route[])
)

const mergeKVResults = <T>(from: (Map<I.Key, T> | null)[]): Map<I.Key, T> => {
  const results = new Map()
  for (let i = 0; i < from.length; i++) {
    const innerMap = from[i]
    if (innerMap != null) for (const [k, v] of innerMap.entries()) results.set(k, v)
  }
  return results
}

const mergeRangeResults = <T>(from: (T[][] | null)[], res: RangeRes): T[][] => (
  res.map(({reverse, inputs}, i) => {
    const r = ([] as T[]).concat(
      ...inputs
        .filter(([bsIdx]) => from[bsIdx] != null)
        .map(([bsIdx, outIdx]) => from[bsIdx]![outIdx])
    )
    return reverse ? r.reverse() : r
  })
)

// const mergeResults = <T>(qtype: I.QueryType, from: (Map<I.Key, T> | null)[] | ([I.Key, T][][] | null)[], res: any, q: I.QueryData) => (
const mergeResults = <T>(qtype: I.QueryType, from: (Map<I.Key, T> | [I.Key, T][][] | null)[], res: any) => (
  qtype === I.QueryType.KV ? mergeKVResults(from as (Map<I.Key, T> | null)[])
    : mergeRangeResults(from as ([I.Key, T][][] | null)[], res)
)


const mapCRKeys = (qtype: I.QueryType, data: I.ReplaceQueryData, mapFn: (k: I.Key, i: number) => I.Key | null) => (
  qtype === I.QueryType.KV
    ? queryTypes[I.QueryType.KV].mapKeys!(data, mapFn)
    : (data as I.StaticRangeQuery[]).map(r => queryTypes[I.QueryType.StaticRange].mapKeys!(r, mapFn))
)

// Consumes data. (It rewrites it in-place)
const mapCatchupMut = <Val>(data: I.CatchupData<Val>, qtype: I.QueryType, routes: Map<I.Key, Route> | Route[], sourceMap: number[]) => {
  // const qr = queryTypes[qtype]

  if (data.replace) {
    // This is super gross. The data format for KVs matches the format for
    // fetches, but the data format for ranges is subtly different. What a
    // mess.
    data.replace.q.q = mapCRKeys(qtype, data.replace.q.q, (bk, i) => {
      const route = qtype === I.QueryType.KV
        ? (routes as Map<I.Key, Route>).get(bk)
        : (routes as Route[])[i]
      // TODO: Why would route be unset here?
      assert(route)
      return route ? changePrefix(bk, route.bPrefix, route.fPrefix) : null
    })
    data.replace.with = qtype === I.QueryType.KV
      ? mapResults(qtype, data.replace.with, routes)
      : (data.replace.with as [I.Key, Val][][][]).map(d => mapResults(qtype, d, routes))

    data.toVersion = mapVersionsBackToFront(data.toVersion, sourceMap)
  }
  
  for (let i = 0; i < data.txns.length; i++) {
    data.txns[i].txn = mapResults(qtype, data.txns[i].txn as I.KVTxn<Val>, routes)
    data.txns[i].versions = mapVersionsBackToFront(data.txns[i].versions, sourceMap)
  }

  data.toVersion = mapVersionsBackToFront(data.toVersion, sourceMap)

  return data
}

// Wrap a subscription with the route mapping.
const mapSub = async function*<Val>(sub: I.Subscription<Val>, qtype: I.QueryType, routes: Map<I.Key, Route> | Route[], sourceMap: number[]) {
  for await (const c of sub) {
    yield mapCatchupMut(c, qtype, routes, sourceMap)
  }
}

const mergeVersionsInto = (dest: I.FullVersion, src: I.FullVersion) => {
  for (let i = 0; i < src.length; i++) dest[i] = src[i]
}

// Consumes both. Returns a.
const composeCatchupsMut = <Val>(qtype: I.QueryType, a: I.CatchupData<Val>, b: I.CatchupData<Val>) => {
  const qt = queryTypes[qtype]

  if (b.replace) {
    if (b.replace.q.type !== qtype) throw new err.InvalidDataError()
    if (a.replace) {
      if (a.replace.q.type !== qtype) throw new err.InvalidDataError()

      const {q, with: w} = qt.composeCR(a.replace, b.replace)
      a.replace.q = q
      a.replace.with = w
      mergeVersionsInto(a.replace.versions, b.replace.versions)
    } else {
      a.replace = b.replace
    }

    // Trim out any transaction data in a that has been replaced by b.
    if (qtype === I.QueryType.KV) {
      let i = 0
      while (i < a.txns.length) {
        const txn = (a.txns[i].txn as I.KVTxn<Val>)
        for (const k in txn.values()) if ((<Set<I.Key>>b.replace.q.q).has(k)) txn.delete(k)

        if (txn.size == 0) a.txns.splice(i, 1)
        else ++i
      }
    } else if (a.txns.length) throw Error('not implemented')
  }

  // Then merge all remaining transactions into a.
  a.txns.push(...b.txns)
  mergeVersionsInto(a.toVersion, b.toVersion)
  return a
}



// Its sad that I need this - its only used for subscription replace queries
// at the moment. Though it will also be used for baked queries in fetch.
const mergeKVQueries = <T>(from: (Set<I.Key> | null)[]): Set<I.Key> => {
  const results = new Set<I.Key>()
  for (let i = 0; i < from.length; i++) {
    const innerMap = from[i]
    if (innerMap != null) for (const k of innerMap) results.add(k)
  }
  return results
}

const mergeRangeQueries = <T>(from: (I.StaticRange[][] | null)[], res: RangeRes): I.StaticRangeQuery[] => (
  // TODO: This is almost identical to mergeRangeResults. Consider merging the
  // two functions.
  res.map(({inputs}, i) => ([] as I.StaticRangeQuery).concat(
    ...inputs
      .filter(([bsIdx]) => from[bsIdx] != null)
      .map(([bsIdx, outIdx]) => from[bsIdx]![outIdx])
  ))
)

const mergeQueries = <T>(qtype: I.QueryType, from: (Set<I.Key> | I.StaticRange[][] | null)[], res: any) => (
  qtype === I.QueryType.KV
    ? mergeKVQueries(from as (Set<I.Key> | null)[])
    : mergeRangeQueries(from as (I.StaticRange[][] | null)[], res)
)

// const noopRange = (): I.StaticRange => ({from: sel(''), to: sel('')})
const mergeCatchups = <Val>(qtype: I.QueryType, cd: I.CatchupData<Val>[], res: any): I.CatchupData<Val> => {
  const result: I.CatchupData<Val> = {txns: [], toVersion: [], caughtUp: false}

  // Check if any of the catchup data contains a replace block
  if (cd.reduce((v, cd) => !!cd.replace || v, false)) {
    // What a mess.
    const q = {
      type: qtype,
      q: mergeQueries(qtype, cd.map(
        c => c.replace == null ? null : c.replace.q.q as Set<I.Key> | I.StaticRange[][]
      ), res)
    } as I.ReplaceQuery

    const w = mergeResults(qtype, cd.map(c => c.replace == null ? null : c.replace.with), res)

    // So the replace versions might not match up. I'm not really sure what to
    // do in that case - it shouldn't really matter; but its technically
    // incorrect.
    const versions = cd.reduce((acc, src) => {
      if (src.replace) {
        const srv = src.replace.versions
        for (let i = 0; i < srv.length; i++) if (srv[i] != null) {
          acc[i] = acc[i] == null ? srv[i] : vMax(acc[i]!, srv[i]!)
        }
      }

      return acc
    }, [] as I.FullVersion)

    result.replace = {q, with: w, versions}
  }

  for (let i = 0; i < cd.length; i++) {
    const src = cd[i]
    // The downside of doing it this way is that the results won't
    // be strictly ordered by version. They should still be
    // correct if applied in sequence.. but its a lil' janky.
    result.txns.push(...src.txns)

    for (let i = 0; i < src.toVersion.length; i++) if (src.toVersion[i] != null) {
      const dv = result.toVersion[i]

      // For some reason when this error happens, it takes a couple seconds for the server to actually crash out.
      // if (dv != null && !vEq(dv, src.toVersion[s])) {
      //   console.log('misaligned', s, dv, src.toVersion[s])
      //   process.exit(1)
      // }

      if (dv == null) result.toVersion[i] = src.toVersion[i]
      else if (!vEq(dv, src.toVersion[i]!)) throw Error('Subscription ops misaligned')
    }

    if (src.caughtUp) result.caughtUp = true
  }

  return result
}

// TODO: Change this API to have the routes passed in at construction time.
export default function router<Val>(): Router<Val> {
  // The routes list is kept sorted in order of frontend ranges
  const routes: Route[] = []
  const sources: string[] = []
  const sourceIsMonotonic: true[] = []

  const getRoute = (k: I.Key) => (
    // This could be rewritten to use binary search. It won't make a huge
    // difference in practice though - the number of routes will usually
    // stay pretty small.
    routes.find(r => sel.kGt(k, r.fRange[0]) && sel.kLt(k, r.fRange[1])) || null
  )

  type ByStore = {
    store: I.Store<Val>,
    q: I.QueryData,
    routes: Map<I.Key, Route> | Route[],

    /** Map from each backend source -> frontend source index. Eg [3,5] */
    sourceMap: number[]
  }

  const splitKeysByStore = (keys: Set<I.Key>) => {
    // const result: [I.Store<Val>, Set<I.Key>, Map<I.Key, Route>, number[]][] = []
    const result: ByStore[] = []

    for (const fKey of keys) {
      const route = getRoute(fKey)
      if (route) {
        const bKey = changePrefix(fKey, route.fPrefix, route.bPrefix)

        let pair = result.find(({store}) => store === route.store)
        let q, routeForKey
        if (pair == null) {
          [q, routeForKey] = [new Set<I.Key>(), new Map()]
          result.push({store: route.store, q, routes: routeForKey, sourceMap: route.sourceMap})
        } else {
          q = pair.q as I.KVQuery
          routeForKey = pair.routes as Map<I.Key, Route>
        }

        q.add(bKey)
        routeForKey.set(bKey, route)
      }
    }

    return result
  }

  const splitRangeByRoutes = (r: I.StaticRange) => {
    const result: [Sel, Sel, Route][] = []
    for (let i = 0; i < routes.length; i++) {
      const {fRange, fPrefix, bPrefix} = routes[i]
      const activeRange = sel.intersect(r.low, r.high, fRange[0], fRange[1])
      if (activeRange != null) {
        result.push([
          changeSelPrefix(activeRange[0], fPrefix, bPrefix),
          changeSelPrefix(activeRange[1], fPrefix, bPrefix),
          routes[i]
        ])
      }
    }
    return result
  }

  const splitRangeQuery = (q: I.StaticRangeQuery) => {
    // For each store, we'll generate the range query that applies to that
    // store and the list of routes that each part of the range query feeds
    // from, to map the query back.
    const byStore: ByStore[] = []

    // When we run the queries we'll have a list of [store, results[][]]
    // that we need to map back into a list of results corresponding to our
    // input range. For each input range we'll produce some data describing
    // how the corresponding output will be generated.

    // res will mirror the format of query.q. For each range in the query,
    // we'll have a list of [byStore index, output index] pairs from which
    // the actual result will be aggregated.
    const res = q.map((r, i) => ({
      inputs: splitRangeByRoutes(r).map(([from, to, route], k) => {
        // console.log('srr', r, from, to, route.fPrefix)
        const {store} = route

        let byStoreIdx = byStore.findIndex(x => x.store === store)
        if (byStoreIdx < 0) {
          byStoreIdx = byStore.push({store, q: [], routes: [], sourceMap: route.sourceMap}) - 1
        }
        const outIdx = (byStore[byStoreIdx].q as I.StaticRangeQuery).push({low:from, high:to}) - 1
        ;(byStore[byStoreIdx].routes as Route[])[outIdx] = route

        return [byStoreIdx, outIdx] as [number, number]
      }),
      reverse: r.reverse || false,
    } as RangeRes[0]))

    return [byStore, res] as [typeof byStore, typeof res]
  }

  const splitQueryByStore = (q: I.Query): [ByStore[], any] => {
    if (q.type === I.QueryType.KV) return [splitKeysByStore(q.q), null]
    else if (q.type === I.QueryType.StaticRange) return splitRangeQuery(q.q)
    else throw new err.UnsupportedTypeError('Router only supports kv queries')
  }

  const isBefore = (v: I.FullVersion, other: I.FullVersion) => {
    for (let i = 0; i < v.length; i++) if (v[i] != null) {
      assert(other[i] != null)
      if (vCmp(v[i]!, other[i]!) < 0) return true
    }
    return false
  }

  const storeInfo = {
    uid: `router()`,
    sources,
    sourceIsMonotonic,
    capabilities: {
      queryTypes: bitSet(I.QueryType.KV, I.QueryType.StaticRange),
      mutationTypes: bitSet(I.ResultType.KV),
    }
  }

  return {
    // Note the storeinfo will change as more stores are added.
    storeInfo,

    // NOTE: You must mount all stores before the router is used.
    // TODO: Enforce that.
    mount(store, fPrefix, range, bPrefix, isOwned) {
      if (range == null) range = ALL
      assert(sel.ltSel(range[0], range[1]), 'Range start must be before range end')

      // TODO: Consider keeping this list sorted.
      const sourceMap = store.storeInfo.sources.map((s, i) => {
        const si = sources.indexOf(s)
        if (si >= 0) return si

        const idx = sources.push(s) - 1
        sourceIsMonotonic.push(true)
        return idx
      })

      // Filter the advertised capabilities to only be those which all our
      // routes support.
      // const {queryTypes, mutationTypes} = this.storeInfo.capabilities
      // const {queryTypes: oqt, mutationTypes: omt} = store.storeInfo.capabilities
      // for (const type of queryTypes) if (!oqt.has(type)) queryTypes.delete(type)
      // for (const type of mutationTypes) if (!omt.has(type)) mutationTypes.delete(type)


      // Ok, now create & add the route to the list.
      const [a, b] = [sel.addPrefix(fPrefix, range[0]), sel.addPrefix(fPrefix, range[1])]

      const route: Route = {
        store, sourceMap, fPrefix, fRange: [a, b], bPrefix, isOwned
      }

      // Check that the new route doesn't overlap an existing route
      let pos = 0
      for(; pos < routes.length; pos++) {
        const r = routes[pos].fRange
        if (sel.ltSel(a, r[1])) {
          assert(sel.LtESel(b, r[0]), 'Routes overlap')
          break
        }
      }

      // Routes are kept sorted
      routes.splice(pos, 0, route)

      // This ends up being quite long, though I'm not sure if that actually matters.
      storeInfo.uid = `router(${routes.map(({store}) => store.storeInfo.uid).join(',')})`
    },

    async fetch(query, frontOpts = {}) {
      // Range support here is a red hot mess. I have a sticky situation in
      // that the implementation for range reads and the implementation for KV
      // reads is similar, but definitely not the same. I could write this in
      // a generic way by specializing a bunch of functionality, but the
      // effect would make it much less readable and I'm not sure its worth
      // the effort. For now I'm just going to maintain two separate
      // implementations.

      const {type: qtype, q} = query
      if (qtype !== I.QueryType.KV && qtype !== I.QueryType.StaticRange) {
        throw new err.UnsupportedTypeError('Invalid type in range query ' + qtype)
      }

      const [byStore, res] = splitQueryByStore(query)

      let versions: I.FullVersionRange = []
      const innerResults = await Promise.all(byStore.map(async ({store, q, routes, sourceMap}) => {
        const backOpts = {...frontOpts}
        if (frontOpts.atVersion) {
          backOpts.atVersion = mapVersionsFrontToBack(frontOpts.atVersion, sourceMap)
        }
        const r = await store.fetch({type: qtype, q} as I.Query, backOpts)

        const newVersions = vIntersectMut(versions, r.versions)
        if (newVersions == null) throw Error('Incompatible versions in results not yet implemented')
        versions = newVersions

        return mapResults(qtype, r.results as I.RangeResult<Val>, routes)
      }))

      return {
        results: mergeResults(qtype, innerResults, res),
        versions,
      }
    },

    async getOps(query, queryVersions, opts) {
      const qtype = query.type
      if (qtype !== I.QueryType.KV && qtype !== I.QueryType.StaticRange) throw new err.UnsupportedTypeError()
      const [byStore, res] = splitQueryByStore(query)

      let validRange: I.FullVersionRange = [] // Output valid version range

      // For now this function requires that the underlying stores each only
      // contain a single source. This is sort of disappointing, but the fully
      // general version of this function requires some fancy graph data
      // structures, and its simply not important enough at the moment.
      
      type SingleTxnData = {txn: I.KVTxn<Val> | I.RangeTxn<Val>, v: I.Version, meta: I.Metadata}
      // const opsForSource = new Map<I.Source, SingleTxnData[]>()
      const frontSourcesUsed: (true | undefined)[] = [] // frontend sources.

      const opsByStore = await Promise.all(byStore.map(async ({store, q, routes, sourceMap}) => {
        const {ops, versions} = await store.getOps(
          {type:query.type, q} as I.Query,
          mapVersionsFrontToBack(queryVersions, sourceMap),
          opts
        )
        
        // We'll just map the keys back here.
        const newValidRange = vIntersectMut(validRange, versions)
        // I think this should never happen in real life. It probably
        // indicates a bug in the backend stores.
        if (newValidRange == null) throw Error('Conflicting valid version ranges in getOps')
        validRange = newValidRange

        let backSourceIdx: number | null = null
        return ops.map(op => {
          // assert(op.txn instanceof Map)

          const sourceIdxs = op.versions.map((v, i) => v == null ? -1 : i).filter(i => i >= 0)
          assert(sourceIdxs.length)

          if (sourceIdxs.length > 1) throw Error('Multiple backend sources in router not implemented yet')
          if (backSourceIdx == null) backSourceIdx = sourceIdxs[0]
          else if (backSourceIdx !== sourceIdxs[0]) throw Error('Multiple backend sources in router not implemented yet')

          frontSourcesUsed[sourceMap[backSourceIdx]] = true

          // Destructively rewrite the keys in each op
          return <SingleTxnData>{
            txn: qtype === I.QueryType.KV
              ? mapKVResults(op.txn as I.KVTxn<Val>, routes as Map<I.Key, Route>)
              : mapRangeResults(op.txn as I.RangeTxn<Val>, routes as Route[]),
            v: op.versions[backSourceIdx],
            meta: op.meta,
          }
        })
      }))

      // There's two transformations we need to do before returning the
      // results:
      //
      // - Merge all the ops from the same source together, with respect to the query
      // - Flatmap the results
      const resultsBySource = frontSourcesUsed.map((hasOps, frontSourceIdx) => {
        if (!hasOps) return []

        // mergeResults(qtype, opsByStore.
        const filtered = opsByStore
          .map((data, i) => (data.length && byStore[i].sourceMap[0] === frontSourceIdx) ? data : null)
          .filter(x => x != null) as SingleTxnData[][]

        // This is all pretty inefficient, but it should be correct enough for
        // now. I can optimize later.

        const merged: I.TxnWithMeta<Val>[] = []
        while (true) {
          // First find the minimum version
          let meta: I.Metadata = null as any
          const versions = filtered.filter(item => item != null && item.length > 0)
            .map(item => {
              meta = item![0].meta // Dodgy.
              return item![0].v
            })

          if (versions.length === 0) break // We're done.

          const minVersion = versions.reduce(vMin)
          const toMerge = filtered.map(item => item != null && item.length > 0 && vEq(item[0].v, minVersion)
            ? item.shift()!.txn : null)

          const txn = mergeResults(qtype, toMerge, res) // TODO: reverse?
          merged.push({
            txn,
            versions: vSparse(frontSourceIdx, minVersion),
            meta,
          })
        }

        return merged
      })

      return {
        ops: ([] as I.TxnWithMeta<Val>[]).concat(...resultsBySource),
        versions: validRange,
      }
    },

    subscribe(q, opts = {}) {
      const id = nextId++
      // console.log(id, 'q', q)
      
      const qtype = q.type
      if (qtype !== I.QueryType.KV && qtype !== I.QueryType.StaticRange) {
        throw new err.UnsupportedTypeError('Router only supports kv and static range queries')
      }

      let {fromVersion} = opts
      if (fromVersion === 'current') throw new Error('opts.fromVersion current not supported by router')

      // Subscribe here merges a view over a number of child subscriptions.
      // When advancing the catchup iterators, we have to group the
      // subscriptions by their sources and merge catchup data
      
      const [byStore, res] = splitQueryByStore(q)
      // console.log('qbs', byStore)

      const childOpts = {
        ...opts,
        alwaysNotify: true
      }
      const childSubs = byStore.map(({store, q, routes, sourceMap}) => {
        const rawSub = store.subscribe({type:qtype, q} as I.Query, childOpts)
        return {
          store,
          sub: iterGuard(mapSub(rawSub, qtype, routes, sourceMap), rawSub.return) as I.AsyncIterableIteratorWithRet<I.CatchupData<Val>>,
        }
      })

      const stream = streamToIter<I.CatchupData<Val>>(() => {
        // We're done reading. Close parents.
        // console.log(id, 'router stream return')
        for (const sub of childSubs) sub.sub.return()
      })

      ;(async () => {
        let finished = false

        // Either opts.fromVersion is set, and we're going to subscribe to all
        // stores from the version specified in the options. Or its not set
        // (its null), and the underlying subscribe functions will do a whole
        // catchup first. Either way by convention we'll get an initial
        // catchup op from the stores; it might just be empty. We forward that
        // on.

        const catchupIterItem = await Promise.all(childSubs.map(({sub}) => sub.next()))

        // Figure out the starting version for subscriptions, which is the
        // max version of everything that was returned.
        fromVersion = []

        const catchups: I.CatchupData<Val>[] = []
        for (let i = 0; i < catchupIterItem.length; i++) {
          const catchup = catchupIterItem[i].value
          if (catchup == null) {
            // One of the child subscriptions ended before it started. Bubble up!
            console.warn('In router child subscription ended before catchup!')
            stream.end()
            for (const sub of childSubs) sub.sub.return()
            return
          }

          for (let si = 0; si < catchup.toVersion.length; si++) {
            const v = catchup.toVersion[si]
            if (v != null) fromVersion[si] = (fromVersion[si] == null) ? v : vMax(fromVersion[si]!, v)
          }
          catchups.push(catchup)
        }

        // console.log('catchups', catchups)

        // Ok, now we need to wait for everyone to catch up to fromVersion!
        const waiting = []
        for (let i = 0; i < catchups.length; i++) {
          if (isBefore(catchups[i].toVersion, fromVersion)) waiting.push((async () => {
            // I could use for-await here, but I want a while loop and its
            // pretty twisty.
            while (!finished && isBefore(catchups[i].toVersion, fromVersion)) {
              const {value, done} = await childSubs[i].sub.next()
              if (done) {
                finished = true;
                return
              }
              composeCatchupsMut(qtype, catchups[i], value)

              for (let si = 0; si < catchups[i].toVersion.length; si++) {
                const tv = catchups[i].toVersion[si]

                if (tv != null && fromVersion[si] != null && vCmp(tv, fromVersion[si]!) > 0) {
                  throw new Error('Skipped target version. Handling this is NYI')
                }
              }
            }
          })())
        }

        await Promise.all(waiting)

        // We'll send all initial catchups in one big first update. This is
        // consistent with the behaviour of stores and will let the router
        // self-compose cleaner.
        //
        // Note we're sending the catchup even if there's no data - if the
        // input query maps to an empty query, we'll still generate an empty
        // catchup which returns nothing.
        // console.log(id, 'initial emitting', mergeCatchups(qtype, catchups, res))
        stream.append(mergeCatchups(qtype, catchups, res))

        // ***** Ok we have our initial data and fromVersion is set now.

        // Next up subscriptions are grouped based on their source. This is
        // needed because the subscription API produces an entire source's
        // updates at once. So if there are two subs with the same source,
        // we need to wait for both subs to tick before returning the merged
        // catchup data to the consumer.
        //
        // And if there are three subs - one with source [a], one with source
        // [a,b] and one with source [b], we'll need to put all of them into a
        // group together.
        //
        // We should be able to have more granularity based on the actual query
        // subscription, but this is fine for now.
        
        const subGroups: {
          store: I.Store<Val>,
          // routes: Route[] | Map<string, Route>,
          sub: I.Subscription<Val>,
        }[][] = []

        {
          // I could convert this to a set, but it should be a really small list
          // anyway. This is all kind of gross - we need childSubs for the
          // cursor functions below, and this code was written to consume them
          // into subGroups. Bleh. POC.
          const subsCopy = childSubs.slice()

          while (subsCopy.length) {
            const groupSources = new Set<I.Source>() // local sources for this group
            const group = [subsCopy.pop()!]
            group[0]!.store.storeInfo.sources.forEach(s => groupSources.add(s))

            let i = 0;
            while (i < subsCopy.length) {
              const store = subsCopy[i].store

              let hasNew = false
              let hasCommon = false
              store.storeInfo.sources.forEach(s => {
                if (groupSources.has(s)) hasCommon = true
                else hasNew = true
              })

              if (hasCommon) {
                // Put the sub+store in the group
                group.push(subsCopy[i])
                subsCopy[i] = subsCopy[subsCopy.length-1]
                subsCopy.length--
                
                if (hasNew) {
                  store.storeInfo.sources.forEach(s => groupSources.add(s))
                  // Try again with all the new sources. This is potentially n^2
                  // with the number of routes / sources; but the number will
                  // usually be small so it shouldn't matter. This could be sped
                  // up; but its not important to do so yet.
                  i = 0
                }
              } else i++
            }

            subGroups.push(group)
          }
        }

        // Ok now we'll start streaming the subscriptions for real.
        for (let i = 0; i < subGroups.length; i++) {
          assert(subGroups[i].length > 0)

          const subs = subGroups[i].map(ss => ss.sub)
          // const routes = subGroups[i].map(ss => ss.routes)

          ;(async () => {
            // First
            while (true) {
              const nexts = await Promise.all(subs.map(sub => sub.next()))

              const updates = nexts.map(({value, done}) => {
                if (done) finished = true
                return value
              })

              // Locally or from another sub group.
              if (finished) {
                // console.log(id, 'finished!')
                break
              }
              
              // console.warn(id, 'merge catchups - updates', updates)

              // I could update fromVersions, but I don't need to. Its not
              // used for anything at this point.
              const merged = mergeCatchups<Val>(qtype, updates, res)
              if (opts.alwaysNotify || merged.replace || merged.txns.length) {
                stream.append(merged)
              }
            }

            // We're done. Propogate upwards
            subs.forEach(sub => sub.return())
          })()
        }

        // This is a little inelegant, but we'll throw any errors up to the client.
      })().catch(err => stream.throw(err))

      return stream.iter
    },

    // Mutation can work through the router, but doing multi-store
    // transactions is too hard / impossible with the current architecture.
    // We'll only allow transactions which hit one store.
    async mutate(type, fTxn, versions, opts) {
      if (type !== I.ResultType.KV) throw new err.UnsupportedTypeError('Only kv mutations supported')
      fTxn = fTxn as I.KVTxn<Val>

      let store = null
      const bTxn = new Map<I.Key, I.Op<Val>>()

      for (const [fk, op] of fTxn) {
        const route = getRoute(fk)
        if (route == null) throw new err.InvalidDataError('Mutation on unmounted key')

        if (store == null) store = route.store
        else if (store !== route.store) {
          // Consider adding a {nonAtomic} flag to allow mutation splitting here.
          throw new err.InvalidDataError('Mutation txn in router cannot span multiple stores')
        }

        const bk = changePrefix(fk, route.fPrefix, route.bPrefix)
        bTxn.set(bk, op)
      }

      if (store == null) return []
      else return store.mutate(I.ResultType.KV, bTxn, versions, opts)
    },
    
    close() {
      const stores = Array.from(new Set(routes.filter(r => r.isOwned).map(r => r.store)))
      stores.forEach(s => s.close())
    },
  }
}
