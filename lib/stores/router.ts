// This implements the router - which lets you back different parts of a
// keyspace with a set of different stores. This code is really ugly and
// doesn't support range queries and a bunch of other stuff.

// This is a genuinely hard & interesting space, and this code is very much a
// first pass solution.

import * as I from '../interfaces'
import err from '../err'
import assert from 'assert'
import streamToIter from '../streamToIter'
import {queryTypes, resultTypes} from '../qrtypes'

import sel from '../sel'

// Selector utilities.
type Sel = I.StaticKeySelector

export type Router = I.Store & {
  mount(store: I.Store, fPrefix: string, range: [Sel, Sel] | null, bPrefix: string, isOwned: boolean): void,
}

type Route = {
  store: I.Store,

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

export const prefixToRange = (prefix: string): [Sel, Sel] => [sel(prefix), sel(prefix+'~')]
export const ALL = prefixToRange('')

const intersectVersionsMut = (dest: I.FullVersionRange, src: I.FullVersionRange) => {
  for (let source in src) {
    const {from: fromSrc, to: toSrc} = src[source]
    if (dest[source] == null) dest[source] = {from: fromSrc, to: toSrc}
    else {
      const {from:fromDest, to:toDest} = dest[source]
      if (fromSrc > toDest || toSrc < fromDest) return null
      dest[source] = {from: Math.max(fromDest, fromSrc), to: Math.min(toDest, toSrc)}
    }
  }
  return dest
}

const changePrefix = (k: I.Key, fromPrefix: string, toPrefix: string) => {
  assert(k.startsWith(fromPrefix))
  return toPrefix + k.slice(fromPrefix.length)
}

const changeSelPrefix = (s: Sel, fromPrefix: string, toPrefix: string): Sel => {
  return sel(changePrefix(s.k, fromPrefix, toPrefix), s.isAfter)
}

const mapKeysInto = <T>(dest: Map<I.Key, T> | null, oldMap: Map<I.Key, T> | null, keyRoutes: Map<I.Key, Route>) => {
  if (dest == null) dest = new Map<I.Key, T>()
  if (oldMap == null) return dest

  const r = resultTypes['kv']

  return r.copyInto!(dest, r.mapEntries(oldMap, (bk, v) => {
    const route = keyRoutes.get(bk!)
    return route == null ? null : [changePrefix(bk!, route.bPrefix, route.fPrefix), v]
  }))
}

const mapKVResults = <T>(from: Map<I.Key, T>, routes: Map<I.Key, Route>): Map<I.Key, T> => (
  resultTypes['kv'].mapEntries(from, (bk, v) => {
    const route = (routes as Map<I.Key, Route>).get(bk!)
    return route == null ? null : [changePrefix(bk!, route.bPrefix, route.fPrefix), v]
  })
)

const mapRangeResults = <T>(from: [I.Key, T][][], routes: Route[]): [I.Key, T][][] => (
  from.map((rr, i) => {
    const route = (routes as Route[])[i]
    return rr.map(
      ([k, v]) => ([changePrefix(k, route.bPrefix, route.fPrefix), v] as I.KVPair)
    )
  })
)

const mapResults = <T>(qtype: I.QueryType, from: Map<I.Key, T> | [I.Key, T][][], routes: Map<I.Key, Route> | Route[]) => (
  qtype === 'kv'
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

const mergeRangeResults = <T>(from: (T[][] | null)[], res: [number, number][][], reverse: boolean): T[][] => (
  res.map((inputs, i) => {
    const r = ([] as T[]).concat(
      ...inputs
        .filter(([bsIdx]) => from[bsIdx] != null)
        .map(([bsIdx, outIdx]) => from[bsIdx]![outIdx])
    )
    return reverse ? r.reverse() : r
  })
)

// const mergeResults = <T>(qtype: I.QueryType, from: (Map<I.Key, T> | null)[] | ([I.Key, T][][] | null)[], res: any, q: I.QueryData) => (
const mergeResults = <T>(qtype: I.QueryType, from: (Map<I.Key, T> | [I.Key, T][][] | null)[], res: any, reverse?: boolean) => (
  qtype === 'kv' ? mergeKVResults(from as (Map<I.Key, T> | null)[])
    : mergeRangeResults(from as ([I.Key, T][][] | null)[], res, reverse || false)
)


// Consumes data. (It rewrites it in-place)
const mapCatchup = (data: I.CatchupData, qtype: I.QueryType, routes: Map<I.Key, Route> | Route[]) => {
  const qr = queryTypes[qtype]

  if (data.replace) {
    data.replace.q.q = qr.mapKeys!(data.replace.q.q, (bk, i) => {
      const route = qtype === 'kv'
        ? (routes as Map<I.Key, Route>).get(bk)
        : (routes as Route[])[i]
      return route ? changePrefix(bk, route.bPrefix, route.fPrefix) : null
    })
    data.replace.with = mapResults(qtype, data.replace.with, routes)
  }

  for (let i = 0; i < data.txns.length; i++) {
    data.txns[i].txn = mapResults(qtype, data.txns[i].txn as I.KVTxn, routes)
  }

  return data
}

// Wrap a subscription with the route mapping.
const mapSub = async function*(sub: I.Subscription, qtype: I.QueryType, routes: Map<I.Key, Route> | Route[]) {
  for await (const c of sub) {
    yield mapCatchup(c, qtype, routes)
  }
}

const mergeVersionsInto = (dest: I.FullVersion, src: I.FullVersion) => {
  for (const s in src) dest[s] = src[s]
}

// Consumes both. Returns a.
const composeCatchupsMut = (qtype: I.QueryType, a: I.CatchupData, b: I.CatchupData) => {
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
    if (qtype === 'kv') {
      let i = 0
      while (i < a.txns.length) {
        const txn = (a.txns[i].txn as I.KVTxn)
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
  const results = new Set()
  for (let i = 0; i < from.length; i++) {
    const innerMap = from[i]
    if (innerMap != null) for (const k of innerMap) results.add(k)
  }
  return results
}

const mergeRangeQueries = <T>(from: (I.StaticRange[][] | null)[], res: [number, number][][]): I.StaticRangeQuery[] => (
  // TODO: This is almost identical to mergeRangeResults. Consider merging the
  // two functions.
  res.map((inputs, i) => {
    const r = ([] as I.StaticRangeQuery).concat(
      ...inputs
        .filter(([bsIdx]) => from[bsIdx] != null)
        .map(([bsIdx, outIdx]) => from[bsIdx]![outIdx])
    )
    return r
  })
)

const mergeQueries = <T>(qtype: I.QueryType, from: (Set<I.Key> | I.StaticRange[][] | null)[], res: any) => (
  qtype === 'kv'
    ? mergeKVQueries(from as (Set<I.Key> | null)[])
    : mergeRangeQueries(from as (I.StaticRange[][] | null)[], res)
)




// // Gross.
// const mapSetKeysInto = (dest: Set<I.Key>, oldSet: Iterable<I.Key>, keyRoutes: Map<I.Key, Route>) => {
//   for (const bk of oldSet) {
//     const route = keyRoutes.get(bk)
//     if (route == null) continue
//     dest.add(changePrefix(bk, route.bPrefix, route.fPrefix))
//   }
//   return dest
// }

// const flatMap = <X, Y>(arr: X[], f: (a: X) => Y[]): Y[] => [].concat.apply([], arr.map(f))




// const noopRange = (): I.StaticRange => ({from: sel(''), to: sel('')})
const mergeCatchups = (qtype: I.QueryType, cd: I.CatchupData[], res: any): I.CatchupData => {
  const result: I.CatchupData = {txns: [], toVersion: {}}

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
        for (const s in srv) {
          acc[s] = acc[s] == null ? srv[s] : Math.max(acc[s], srv[s])
        }
      }

      return acc
    }, {} as I.FullVersion)

    result.replace = {q, with: w, versions}
  }

  for (let i = 0; i < cd.length; i++) {
    const src = cd[i]
    // The downside of doing it this way is that the results won't
    // be strictly ordered by version. They should still be
    // correct if applied in sequence.. but its a lil' janky.
    result.txns.push(...src.txns)

    for (const s in src.toVersion) {
      const dv = result.toVersion[s]
      if (dv == null) result.toVersion[s] = src.toVersion[s]
      else if (dv !== src.toVersion[s]) throw Error('Subscription ops misaligned')
    }
  }

  return result
}


export default function router(): Router {
  // The routes list is kept sorted in order of frontend ranges
  const routes: Route[] = []
  const sources: string[] = []

  const getRoute = (k: I.Key) => (
    // This could be rewritten to use binary search. It won't make a huge
    // difference in practice though - the number of routes will usually
    // stay pretty small.
    routes.find(r => sel.kGt(k, r.fRange[0]) && sel.kLt(k, r.fRange[1])) || null
  )

  const splitKeysByStore = (keys: Set<I.Key>) => {
    const result: [I.Store, Set<I.Key>, Map<I.Key, Route>][] = []

    for (const fKey of keys) {
      const route = getRoute(fKey)
      if (route) {
        const bKey = changePrefix(fKey, route.fPrefix, route.bPrefix)

        let pair = result.find(([s]) => s === route.store)
        let q, routeForKey
        if (pair == null) {
          [q, routeForKey] = [new Set(), new Map()]
          result.push([route.store, q, routeForKey])
        } else {
          q = pair[1], routeForKey = pair[2]
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
      const activeRange = sel.intersect(r.from, r.to, fRange[0], fRange[1])
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
    const byStore: [I.Store, I.StaticRangeQuery, Route[]][] = []

    // When we run the queries we'll have a list of [store, results[][]]
    // that we need to map back into a list of results corresponding to our
    // input range. For each input range we'll produce some data describing
    // how the corresponding output will be generated.

    // res will mirror the format of query.q. For each range in the query,
    // we'll have a list of [byStore index, output index] pairs from which
    // the actual result will be aggregated.
    const res = q.map((r, i) => (
      splitRangeByRoutes(r).map(([from, to, route], k) => {
        const {store} = route

        let byStoreIdx = byStore.findIndex(x => x[0] === store)
        if (byStoreIdx < 0) {
          byStoreIdx = byStore.push([store, [], []]) - 1
        }
        const outIdx = byStore[byStoreIdx][1].push({from, to}) - 1
        byStore[byStoreIdx][2][outIdx] = route

        return [byStoreIdx, outIdx] as [number, number]
      })
    ))

    return [byStore, res] as [typeof byStore, typeof res]
  }

  const splitQueryByStore = (q: I.Query): [[I.Store, I.QueryData, Map<I.Key, Route> | Route[]][], any] => {
    if (q.type === 'kv') return [splitKeysByStore(q.q), null]
    else if (q.type === 'static range') return splitRangeQuery(q.q)
    else throw new err.UnsupportedTypeError('Router only supports kv queries')
  }

  const isBefore = (v: I.FullVersion, other: I.FullVersion) => {
    for (const s in v) {
      assert(other[s] != null)
      if (v[s] < other[s]) return true
    }
    return false
  }

  return {
    // Note the storeinfo will change as more stores are added.
    storeInfo: {
      sources,
      capabilities: {
        queryTypes: new Set<I.QueryType>(['kv', 'static range']),
        mutationTypes: new Set<I.ResultType>(['kv']),
      }
    },

    mount(store, fPrefix, range, bPrefix, isOwned) {
      if (range == null) range = ALL
      assert(sel.ltSel(range[0], range[1]), 'Range start must be before range end')

      store.storeInfo.sources.forEach(s => {
        if (!sources.includes(s)) sources.push(s)
      })
      // Filter the advertised capabilities to only be those which all our
      // routes support.
      const {queryTypes, mutationTypes} = this.storeInfo.capabilities
      const {queryTypes: oqt, mutationTypes: omt} = store.storeInfo.capabilities
      for (const type of queryTypes) if (!oqt.has(type)) queryTypes.delete(type)
      for (const type of mutationTypes) if (!omt.has(type)) mutationTypes.delete(type)


      // Ok, now create & add the route to the list.
      const [a, b] = [sel.addPrefix(fPrefix, range[0]), sel.addPrefix(fPrefix, range[1])]

      const route: Route = {
        store, fPrefix, fRange: [a, b], bPrefix, isOwned
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
    },

    async fetch(query, opts = {}) {
      // Range support here is a red hot mess. I have a sticky situation in
      // that the implementation for range reads and the implementation for KV
      // reads is similar, but definitely not the same. I could write this in
      // a generic way by specializing a bunch of functionality, but the
      // effect would make it much less readable and I'm not sure its worth
      // the effort. For now I'm just going to maintain two separate
      // implementations.

      const {type: qtype, q} = query
      if (qtype !== 'kv' && qtype !== 'static range') {
        throw new err.UnsupportedTypeError('Invalid type in range query ' + qtype)
      }

      const [byStore, res] = splitQueryByStore(query)

      let versions: I.FullVersionRange = {}
      const innerResults = await Promise.all(byStore.map(async ([store, q, routes]) => {
        const r = await store.fetch({type: qtype, q} as I.Query, opts)

        const newVersions = intersectVersionsMut(versions, r.versions)
        if (newVersions == null) throw Error('Incompatible versions in results not yet implemented')
        versions = newVersions

        return mapResults(qtype, r.results as I.RangeResult, routes)
      }))

      return {
        results: mergeResults(qtype, innerResults, res), // TODO: Fix reverse.
        versions,
      }
    },

    async getOps(query, queryVersions, opts) {
      const qtype = query.type
      if (qtype !== 'kv' && qtype !== 'static range') throw new err.UnsupportedTypeError()
      const [byStore, res] = splitQueryByStore(query)

      let validRange: I.FullVersionRange = {} // Output valid version range

      // For now this function requires that the underlying stores each only
      // contain a single source. This is sort of disappointing, but the fully
      // general version of this function requires some fancy graph data
      // structures, and its simply not important enough at the moment.
      
      type SingleTxnData = {txn: I.KVTxn | I.RangeTxn, v: I.Version, meta: I.Metadata}
      // const opsForSource = new Map<I.Source, SingleTxnData[]>()
      const allSources = new Set<I.Source>()

      const opsByStore = await Promise.all(byStore.map(async ([store, q, routes]) => {
        const {ops, versions} = await store.getOps({type:query.type, q} as I.Query, queryVersions, opts)
        
        // We'll just map the keys back here.
        const newValidRange = intersectVersionsMut(validRange, versions)
        // I think this should never happen in real life. It probably
        // indicates a bug in the backend stores.
        if (newValidRange == null) throw Error('Conflicting valid version ranges in getOps')
        validRange = newValidRange

        let source: I.Source | null = null
        return ops.map(op => {
          // assert(op.txn instanceof Map)

          const sources = Object.keys(op.versions)
          assert(sources.length)

          if (sources.length > 1) throw Error('Multiple backend sources in router not implemented yet')
          if (source == null) source = sources[0]
          else if (source !== sources[0]) throw Error('Multiple backend sources in router not implemented yet')

          allSources.add(source)

          // Destructively rewrite the keys in each op
          return <SingleTxnData>{
            txn: qtype === 'kv'
              ? mapKVResults(op.txn as I.KVTxn, routes as Map<I.Key, Route>)
              : mapRangeResults(op.txn as I.RangeTxn, routes as Route[]),
            v: op.versions[source],
            meta: op.meta,
          }
        })
      }))

      // There's two transformations we need to do before returning the
      // results:
      //
      // - Merge all the ops from the same source together, with respect to the query
      // - Flatmap the results
      const resultsBySource = Array.from(allSources).map(source => {
        // mergeResults(qtype, opsByStore.
        const filtered = opsByStore
          .filter(item => item.length !== 0)
          .map((data, i) => byStore[i][0].storeInfo.sources[0] === source ? data : null)

        // This is all pretty inefficient, but it should be correct enough for
        // now. I can optimize later.

        const merged: I.TxnWithMeta[] = []
        while (true) {
          // First find the minimum version
          let meta: I.Metadata = null as any
          const versions = filtered.filter(item => item != null && item.length > 0)
            .map(item => {
              meta = item![0].meta // Dodgy.
              return item![0].v
            })

          if (versions.length === 0) break // We're done.

          const minVersion = Math.min(...versions)
          const toMerge = filtered.map(item => item != null && item.length > 0 && item[0].v === minVersion
            ? item.shift()!.txn : null)

          const txn = mergeResults(qtype, toMerge, res) // TODO: reverse?
          merged.push({
            txn,
            versions: {[source]: minVersion},
            meta,
          })
        }

        return merged
      })

      return {
        ops: ([] as I.TxnWithMeta[]).concat(...resultsBySource),
        versions: validRange,
      }
    },

    subscribe(q, opts = {}) {
      const qtype = q.type
      if (qtype !== 'kv' && qtype !== 'static range') {
        throw new err.UnsupportedTypeError('Router only supports kv queries')
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
      const childSubs = byStore.map(([store, q, routes]) => ({
        store,
        // routes,
        sub: mapSub(store.subscribe({type:qtype, q} as I.Query, childOpts), qtype, routes) as I.AsyncIterableIteratorWithRet<I.CatchupData>,
      }))

      const stream = streamToIter<I.CatchupData>(() => {
        // We're done reading. Close parents.
        for (const sub of childSubs) sub.sub.return()
      })

      ;(async () => {
        let finished = false

        // We have 2 modes we're operating in: Either opts.fromVersion is set,
        // and we're going to subscribe to all stores from the same version.
        // Or its not set (its null), and the underlying subscribe functions
        // will do a whole catchup first.

        if (fromVersion == null) {
          // We need to read the first catchup operation from all child subs
          // before doing anything else.
          const catchupIterItem = await Promise.all(childSubs.map(({sub}) => sub.next()))

          // Figure out the starting version for subscriptions, which is the
          // max version of everything that was returned.
          fromVersion = {}

          const catchups: I.CatchupData[] = []
          for (let i = 0; i < catchupIterItem.length; i++) {
            const catchup = catchupIterItem[i].value
            if (catchup == null) {
              // One of the child subscriptions ended before it started. Bubble up!
              console.warn('In router child subscription ended before catchup!')
              stream.end()
              for (const sub of childSubs) sub.sub.return()
              return
            }

            for (const s in catchup.toVersion) {
              fromVersion[s] = Math.max(fromVersion[s], catchup.toVersion[s])
            }
            catchups.push(catchup)
          }

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

                for (const s in catchups[i].toVersion) {
                  if (catchups[i].toVersion[s] > fromVersion[s]) {
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
          if (catchups.length) stream.append(mergeCatchups(qtype, catchups, res))
        }

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
          store: I.Store,
          // routes: Route[] | Map<string, Route>,
          sub: I.Subscription,
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
              if (finished) break

              // I could update fromVersions, but I don't need to. Its not
              // used for anything at this point.
              stream.append(mergeCatchups(qtype, updates, res))
            }
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
      if (type !== 'kv') throw new err.UnsupportedTypeError('Only kv mutations supported')
      fTxn = fTxn as I.KVTxn

      let store = null
      const bTxn = new Map<I.Key, I.Op>()

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

      if (store == null) return {}
      else return store.mutate('kv', bTxn, versions, opts)
    },
    
    close() {
      const stores = Array.from(new Set(routes.filter(r => r.isOwned).map(r => r.store)))
      stores.forEach(s => s.close())
    },
  }
}