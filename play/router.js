// Router is a list of (non-overlapping) route ranges
const afterAll = require('after-all-results')
const assert = require('assert')

const {mapKey, mapRange, inRange} = require('./util')

const min = (a, b) => a < b ? a : b
const max = (a, b) => a > b ? a : b

const prefixToRange = (prefix) => [prefix, prefix+'~']
const ALL = prefixToRange('')

const getDef = (map, key, fn) => {
  let v = map.get(key)
  if (v == null) {
    v = fn(key)
    map.set(key, v)
  }
  return v
}
const newArray = () => []

function versionIntersection(dest, src) {
  // Take the intersection of 
  for (let source in src) {
    const vIn = src[source]
    const vOut = dest[source]

    if (!vOut) {
      dest[source] = vIn
    } else {
      // Intersect.
      if (vIn[0] > vOut[1] || vIn[1] < vOut[0]) {
        // TODO: Non-overlapping versions. For now abort. Later, await the data
        // from the behind server in question via a subscription.
        throw Error('Non-overlapping version data')
      }

      vOut[0] = max(vOut[0], vIn[0])
      vOut[1] = min(vOut[1], vIn[1])
    }
  }

  return dest
}


class Router {
  constructor() {
    // Stored in frontend-visible range order. Overlapping not allowed. Append with mount().
    //
    // source: Data source to hit with request
    // fRange: Front visible range (eg users/byCar to users/byCar~)
    // fPrefix: Characters to strip from input range start&end (eg 'users/')
    // bPrefix: characters (if any) to prefix on the range when sending to the named source.
    this.routes = []
  }

  mount(source, bPrefix, lRange, fPrefix) {
    // Splice the route in order in the routes list. Binary tree or something
    // would be good here but there shouldn't be many routes, so this is fine for
    // now.
    assert(lRange[0] < lRange[1])

    const fRange = [fPrefix + lRange[0], fPrefix + lRange[1]]
    const route = {source, fRange, fPrefix, bPrefix}

    const [a, b] = fRange

    for(let i = 0; i < this.routes.length; i++) {
      const r = this.routes[i].fRange
      if (a <= r[1]) {
        assert(a < r[0] && b < r[0], 'Routes overlap')
        this.routes.splice(i, 0, route)
        return
      }
    }
    this.routes.push(route)
  }


  // [a, b] is inclusive.
  routeIntersection(a, b) {
    const results = []

    let x = a
    // First try to find the route that overlaps
    for(let i = 0; i < this.routes.length; i++) {
      const route = this.routes[i]
      const [r0, r1] = route.fRange

      if (b < r0 || x > r1) continue

      // We've found the next route.
      x = max(x, r0)
      const end = min(b, r1)
      results.push({route, fRange:[x, end]})

      if (r1 >= b) break
    }

    console.log('RI', a, b, results)
    return results
  }

  getMappingsFor(ranges) {
    // First go through all the ranges and split them out based on our routes.
    const mappingsForSource = new Map

    // If the requested range set was sorted we could do this in O(nlogn)ish instead of O(n*k)
    for (let i = 0; i < ranges.length; i++) {
      const [a, b] = ranges[i]
      this.routeIntersection(a, b).forEach(({route:{source, fPrefix, bPrefix}, fRange}) => {
        const mappings = getDef(mappingsForSource, source, newArray)

        // Map the intersecting frontend range to the equivalent backend range.
        // Note that multiple front ranges could overlap. This would be more
        // efficient if we keep the back range set sorted.
        mappings.push({
          bRange: mapRange(fRange, fPrefix, bPrefix),
          fPrefix,
          bPrefix,
        })
      })
    }

    return mappingsForSource
  }

  fetch(ranges, versions, callback) {
    console.log('Fetching', ranges)

    const mappingsForSource = this.getMappingsFor(ranges)
    console.log('mapping', mappingsForSource)

    const next = afterAll((err, allResults) => {
      if (err) return callback(err)

      console.log('Got results back', allResults)

      const resultVersions = {}
      const data = {}

      for (let i = 0; i < allResults.length; i++) {
        const {results, versions, mappings} = allResults[i]

        versionIntersection(resultVersions, versions)

        //for (k in r.results) data[k] = r.results[k]
        for (let j = 0; j < mappings.length; j++) {
          const {bRange, fPrefix, bPrefix} = mappings[j]
          // This is really inefficient but whatever.
          for (let bk in results) {
            if (inRange(bk, bRange)) {
              const fk = mapKey(bk, bPrefix, fPrefix)
              data[fk] = results[bk]
            }
          }
          //console.log('mapping', results)
        }
      }

      callback(null, {results: data, versions: resultVersions})
    })

    mappingsForSource.forEach((mappings, source) => {
      console.log('target', mappings, versions)

      // Map the routes. Note that the mapped routes can overlap. This would be more efficient if we 
      
      source.fetch(mappings.map(m => m.bRange), versions, next((err, result) => {
        // AAR (weirdly) calls this sync before the results are collected.
        if (result) {
          result.mappings = mappings
        }
      }))
    })
  }

  streamOps(ranges, versions, listener, callback) {
    
  }
};

module.exports = () => new Router()

