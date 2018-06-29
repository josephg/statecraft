import * as I from '../types/interfaces'
import err from '../err'
import {queryTypes} from '../types/queryops'
import assert = require('assert')

export type Router = I.Store & {
  mount(store: I.Store, fPrefix: string, range: [string, string], bPrefix: string, isOwned: boolean): void,
}

type Route = {
  store: I.Store,

  // Frontend prefix (eg movies/)
  fPrefix: string,
  // Frontend range (eg ['movies/m', 'movies/q'])
  fRange: [string, string],

  // Backend prefix (eg imdb/)
  bPrefix: string,

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

  return {
    mount(store, fPrefix, range, bPrefix, isOwned) {
      assert(range[0] < range[1], 'Range start must be before range end')

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
      if (q.type !== 'kv') throw err.UnsupportedTypeError('Router only supports kv queries')

      // const routeForKey = new Map<I.Key, Route>()
      const byStore = new Map<I.Store, Map<I.Key, Route>>()

      for (const fKey of q.q) {
        const route = getRoute(fKey)
        if (route) {
          const bKey = changePrefix(fKey, route.fPrefix, route.bPrefix)
          // routeForKey.set(k, route)

          let info = byStore.get(route.store)
          if (info == null) {
            info = new Map()
            byStore.set(route.store, info)
          }
          // info.bKeys.add(bKey)
          info.set(bKey, route)

        }
      }

      const storeAndQueries = Array.from(byStore)
      const resultList = await Promise.all(storeAndQueries.map(([store, keys]) => (
        store.fetch({type:'kv', q:new Set(keys.keys())}, opts)))
      )

      // const results: I.FetchResults = {
      //   results: new Map(),
      //   queryRun: q,
      //   versions: {},
      // }

      const results = new Map<I.Key, any>()
      let versions: I.FullVersionRange = {}

      for (let i = 0; i < storeAndQueries.length; i++) {
        const [store, routeForBKey] = storeAndQueries[i]
        const r = resultList[i]

        for (const [k, v] of r.results) {
          const route = routeForBKey.get(k)
          if (route == null) continue // We got a result we didn't ask for.
          const fKey = changePrefix(k, route.bPrefix, route.fPrefix)
          results.set(fKey, v)
        }

        const newVersions = intersectVersionsMut(versions, r.versions)
        if (newVersions == null) throw Error('Overlapping versions in results not yet implemented')
        versions = newVersions
      }

      return {
        results,
        queryRun: q,
        versions,
      }
    },

    mutate() { throw Error('nyi') },
    async getOps() { throw Error('nyi') },
    subscribe() { throw Error('nyi') },

    close() {
      const stores = Array.from(new Set(routes.filter(r => r.isOwned).map(r => r.store)))
      stores.forEach(s => s.close())
    },
  }
}