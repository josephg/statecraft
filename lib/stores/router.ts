// This implements the router - which lets you back different parts of a
// keyspace with a set of different stores. This code is really ugly and
// doesn't support range queries and a bunch of other stuff.

// This is a genuinely hard & interesting space, and this code is very much a
// first pass solution.

import * as I from '../types/interfaces'
import err from '../err'
import {queryTypes} from '../types/queryops'
import assert = require('assert')
import streamToIter from '../streamToIter'

export type Router = I.Store & {
  mount(store: I.Store, fPrefix: string, range: [string, string] | null, bPrefix: string, isOwned: boolean): void,
}

type Route = {
  store: I.Store,

  // Frontend prefix (eg movies/)
  fPrefix: string,
  // Frontend range (eg ['movies/m', 'movies/q'])
  fRange: [string, string],

  // Backend prefix (eg imdb/)
  bPrefix: string,

  // Are we the exclusive owner of the backend DB? Aka, when the router is
  // closed, should we chain close the backend?
  isOwned: boolean,
}

export const prefixToRange = (prefix: string): [string, string] => [prefix, prefix+'~']
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

const mapKeysInto = <T>(dest: Map<I.Key, T> | null, oldMap: Map<I.Key, T> | null, keyRoutes: Map<I.Key, Route>) => {
  if (dest == null) dest = new Map<I.Key, T>()
  if (oldMap == null) return dest

  for (const [bk, v] of oldMap) {
    const route = keyRoutes.get(bk)
    if (route == null) continue // We got a result we didn't ask for.
    dest.set(changePrefix(bk, route.bPrefix, route.fPrefix), v)
  }
  return dest
}

// Gross.
const mapSetKeysInto = (dest: Set<I.Key> | null, oldSet: Iterable<I.Key>, keyRoutes: Map<I.Key, Route>) => {
  if (dest == null) dest = new Set<I.Key>()

  for (const bk of oldSet) {
    const route = keyRoutes.get(bk)
    if (route == null) continue
    dest.add(changePrefix(bk, route.bPrefix, route.fPrefix))
  }
  return dest
}

const flatMap = <X, Y>(arr: X[], f: (a: X) => Y[]): Y[] => [].concat.apply([], arr.map(f))

export default function router(): Router {
  const routes: Route[] = []
  const sources: string[] = []

  const getRoute = (k: I.Key) => {
    for (let i = 0; i < routes.length; i++) {
      const r = routes[i]
      if (k >= r.fRange[0] && k < r.fRange[1]) return r
    }
    return null
  }

  const splitKeysByStore = (keys: Set<I.Key>) => {
    const result = new Map<I.Store, Map<I.Key, Route>>()

    for (const fKey of keys) {
      const route = getRoute(fKey)
      if (route) {
        const bKey = changePrefix(fKey, route.fPrefix, route.bPrefix)

        let routeForKey = result.get(route.store)
        if (routeForKey == null) {
          routeForKey = new Map()
          result.set(route.store, routeForKey)
        }
        routeForKey.set(bKey, route)
      }
    }

    return result
  }

  const splitQueryByStore = (q: I.Query) => {
    if (q.type !== 'kv') throw new err.UnsupportedTypeError('Router only supports kv queries')
    return splitKeysByStore(q.q)
  }

  return {
    mount(store, fPrefix, range, bPrefix, isOwned) {
      if (range == null) range = ALL
      assert(range[0] < range[1], 'Range start must be before range end')

      store.storeInfo.sources.forEach(s => {
        if (!sources.includes(s)) sources.push(s)
      })

      const fRange: [string, string] = [fPrefix + range[0], fPrefix + range[1]]
      const route: Route = {
        store, fPrefix, fRange, bPrefix, isOwned
      }

      // Check that the new route doesn't overlap an existing route
      const [a, b] = fRange
      for(let i = 0; i < routes.length; i++) {
        const r = routes[i].fRange
        if (a <= r[1]) assert(a < r[0] && b < r[0], 'Routes overlap')
      }

      routes.push(route)
    },

    // Note the storeinfo will change as more stores are added.
    storeInfo: {
      sources,
      capabilities: {
        queryTypes: new Set<I.QueryType>(['kv']),
        mutationTypes: new Set<I.ResultType>(['resultmap']),
      }
    },

    async fetch(q, opts) {
      const byStore = splitQueryByStore(q)

      const results = new Map<I.Key, any>()
      // This is the version range at which the results are valid, which is
      // the intersection of the result versions.
      let versions: I.FullVersionRange = {}

      await Promise.all(Array.from(byStore).map(async ([store, keyRoutes]) => {
        const r = await store.fetch({type:'kv', q:new Set(keyRoutes.keys())}, opts)

        mapKeysInto(results, r.results, keyRoutes)

        const newVersions = intersectVersionsMut(versions, r.versions)
        // This happens if the backend databases return data with different versions. We can
        // re-fetch from one or both stores in question and use MVCC to resolve.
        if (newVersions == null) throw Error('Incompatible versions in results not yet implemented')
        versions = newVersions        
      }))

      return {
        queryRun: q,
        results,
        versions,
      }
    },

    async getOps(q, queryVersions, opts) {
      const byStore = splitQueryByStore(q)
      const byStoreList = Array.from(byStore)

      let validRange: I.FullVersionRange = {} // Output valid version range

      // For now this function requires that the underlying stores only
      // contain a single source. This is sort of disappointing, but the fully
      // general version of this function requires some fancy graph data
      // structures, and its simply not important enough at the moment.
      
      type SingleTxn = {txn: I.KVTxn, v: I.Version, uid?: string}
      const opsForSource = new Map<I.Source, SingleTxn[]>()

      await Promise.all(byStoreList.map(async ([store, keyRoutes]) => {
        const {ops, versions} = await store.getOps({type:'kv', q:new Set(keyRoutes.keys())}, queryVersions, opts)
        
        // We'll just map the keys back here.
        const newValidRange = intersectVersionsMut(validRange, versions)
        // I think this should never happen in real life. It probably
        // indicates a bug in the backend stores.
        if (newValidRange == null) throw Error('Conflicting valid version ranges in getOps')
        validRange = newValidRange

        const mappedOps: SingleTxn[] = []
        let source: I.Source | null = null
        for (let i = 0; i < ops.length; i++) {
          const op = ops[i]
          assert(op.txn instanceof Map)

          const sources = Object.keys(op.versions)
          assert(sources.length)

          if (sources.length > 1) throw Error('Multiple backend sources in router not implemented yet')
          if (source == null) source = sources[0]
          else if (source !== sources[0]) throw Error('Multiple backend sources in router not implemented yet')

          // Destructively rewrite the keys in each op
          mappedOps.push({
            txn: mapKeysInto(null, op.txn as Map<I.Key, I.Op>, keyRoutes),
            v: op.versions[source],
            uid: op.uid,
          })
        }
        if (source == null) return // No ops.

        const oldMerged = opsForSource.get(source)
        if (oldMerged == null) opsForSource.set(source, mappedOps)
        else {
          // Merge mappedOps into mergedOps.
          const merged: SingleTxn[] = []

          while (oldMerged.length && mappedOps.length) {
            if (oldMerged.length == 0) {merged.push.call(merged, mappedOps); break}
            if (mappedOps.length == 0) {merged.push.call(merged, oldMerged); break}

            const a = oldMerged[0]
            const b = mappedOps[0]

            if (a.v === b.v) {
              // Merge them together
              oldMerged.shift(); mappedOps.shift()
              assert.strictEqual(a.uid, b.uid)
              merged.push({
                // TODO: Replace this with a result type specific merge function.
                txn: new Map(Array.from(a.txn).concat(Array.from(b.txn))), // gross.
                v: a.v,
                uid: a.uid,
              })
            } else if (a.v < b.v) merged.push(oldMerged.shift()!)
            else if (a.v > b.v) merged.push(mappedOps.shift()!)
            else throw Error('Invalid state')
          }

          opsForSource.set(source, merged)
        }
      }))

      return {
        ops: flatMap(Array.from(opsForSource),
          ([source, ops]) => ops.map(({txn, v, uid}) => ({txn, versions: {[source]: v}, uid}))),
        versions: validRange,
      }
    },

    subscribe(q, opts = {}) {
      if (q.type !== 'kv') throw new err.UnsupportedTypeError('Router only supports kv queries')

      // Subscribe here merges a view over a number of child subscriptions.
      // 
      // - For advancing the cursors, we do them one at a time
      // - When advancing the catchup iterators, we have to group the
      //   subscriptions by their sources and merge catchup data
      
      // List of [store, Map<Key, Route>]
      const queryByStore = Array.from(splitQueryByStore(q))
      // console.log('qbs', queryByStore)

      const childOpts = {
        ...opts,
        knownAtVersions: opts.knownAtVersions,
        alwaysNotify: true
      }
      const knownDocsByStore = opts.knownDocs ? splitKeysByStore(opts.knownDocs as Set<I.Key>) : null
      const childSubs = queryByStore.map(([store, keyRoutes]) => {
        const knownDocMap = knownDocsByStore && knownDocsByStore.get(store)
        return {
          store,
          keyRoutes,
          sub: store.subscribe({type:'kv', q:new Set(keyRoutes.keys())}, {
            ...childOpts,
            knownDocs: knownDocMap ? new Set(knownDocMap.keys()) : undefined,
          }),
        }
      })

      // console.log('subscribing to', queryByStore.map(([store, keyRoutes]) => (new Set(keyRoutes.keys()))))

      let activeVersions: I.FullVersionRange = {}

      // Subscriptions are grouped based on their source. This is needed
      // because the subscription API produces an entire source's updates at
      // once. So if there are two subs with the same source, we need to wait
      // for both subs to tick before returning the merged catchup data to the
      // consumer.
      //
      // And if there are three subs - one with source [a], one with source
      // [a,b] and one with source [b], we'll need to put all of them into a
      // group together.
      //
      // We should be able to have more granularity based on the actual query
      // subscription, but this is fine for now.

      const subGroups: {
        store: I.Store,
        keyRoutes: Map<string, Route>,
        sub: I.Subscription
      }[][] = []
      // const groupForSource = new Map<I.Source, number>()

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

      // console.log('subgroups', subGroups.map(sg => sg.map(ss => ss.store.storeInfo.sources)))


      // Unfortunately I don't have a way to cancel the Promise.all I'm using below.
      // I'll just wait for the data to return then close it out.
      let cancelled = false

      const stream = streamToIter<I.CatchupData>(() => {
        // self.allSubs.delete(sub)
        cancelled = true
      })

      for (let i = 0; i < subGroups.length; i++) {
        const iters = subGroups[i].map(ss => ss.sub.iter)
        const keyRoutes = subGroups[i].map(ss => ss.keyRoutes)
        ;(async () => {
          while (true) {
            // console.log('aa', iters.map(i => i.next()))
            // iters[0].next().then(x => console.log('stream iter next', x))
            const nexts = await Promise.all(iters.map(i => i.next()))
            // console.log('nexts', nexts)
            if (cancelled) break

            const nextResult: I.CatchupData = {
              // Versions merged into activeVersions.
              resultingVersions: {}, // Acceptable version range for results post txns
              txns: [],
            }

            for (let n = 0; n < nexts.length; n++) {
              const {done, value} = nexts[n]

              // console.log('value', value)
              // TODO To make this work we'll need to make the replace data
              // also name the query around which we're replacing contents
              if (value.replace && value.replace.with.size) {
                // console.log('replace', value.replace)

                let replace = nextResult.replace
                if (replace == null) {
                  replace = nextResult.replace = {
                    q: {type: "kv", q: new Set()},
                    with: new Map<I.Key, I.Val>(),
                  }
                }

                if (value.replace.q.type !== 'kv') throw Error('Unimplemented r type')
                mapSetKeysInto((replace.q as any).q, value.replace.q.q, keyRoutes[n])
                mapKeysInto(replace.with, value.replace.with, keyRoutes[n])
              }

              if (done || !value) throw new Error('Child subscription ended prematurely')

              if (intersectVersionsMut(nextResult.resultingVersions, value.resultingVersions) == null) {
                // TODO We should be able to handle this in a lot of cases.
                console.log('xrp', nextResult.resultingVersions, value.resultingVersions)
                throw new Error('Subscription ops misaligned')
              }

              value.txns.forEach(({versions, txn, uid}) => {
                // The downside of doing it this way is that the results won't
                // be strictly ordered by version. They should still be
                // correct if applied in sequence though.
                nextResult.txns.push({
                  versions, uid,
                  txn: mapKeysInto(null, txn as I.KVTxn, keyRoutes[n])
                })
              })
            }

            for (let source in nextResult.resultingVersions) {
              activeVersions[source] = nextResult.resultingVersions[source]
            }
            stream.append(nextResult)
          }

          iters.forEach(iter => iter.return())
        })() // Errors are passed to the global uncaught error handler.
      }


      let cursorNextSub = 0
      let activeQuery = {type: ('kv' as 'kv'), q: new Set<I.Key>()}

      return {
        async cursorNext() {
          // console.log('css', cursorNextSub, childSubs.length)
          if (cursorNextSub < childSubs.length) {
            const {sub, keyRoutes} = childSubs[cursorNextSub]
            const next = await sub.cursorNext()
            // console.log('cursorNext', next)
            if (next.activeQuery.type !== 'kv') throw Error('Unsupported result type ' + next.activeQuery.type)
            mapSetKeysInto(activeQuery.q, next.activeQuery.q, keyRoutes)
            if (intersectVersionsMut(activeVersions, next.activeVersions) == null) {
              throw Error('Non-intersecting subscription results - resolving this has not yet been implemented')
            }

            if (sub.isComplete()) cursorNextSub++
          }
          return {activeQuery, activeVersions}
        },

        async cursorAll() {
          while (true) {
            const result = await this.cursorNext(opts)
            if (this.isComplete()) return result
          }
        },

        isComplete() {
          // True if all subs are complete.
          return cursorNextSub >= childSubs.length
        },

        iter: stream.iter,
        [Symbol.asyncIterator]() { return stream.iter },
      }
    },

    // Mutation can work through the router, but doing multi-store
    // transactions is too hard / impossible with the current architecture.
    // We'll only allow transactions which hit one store.
    async mutate(type, fTxn, versions, opts) {
      console.log('xxx router mutate opts', opts)
      if (type !== 'resultmap') throw new err.UnsupportedTypeError('Only resultmap mutations supported')
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
      else return store.mutate('resultmap', bTxn, versions, opts)
    },
    
    close() {
      const stores = Array.from(new Set(routes.filter(r => r.isOwned).map(r => r.store)))
      stores.forEach(s => s.close())
    },
  }
}