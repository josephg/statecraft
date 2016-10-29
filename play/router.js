// Router is a list of (non-overlapping) route ranges
const afterAll = require('after-all-results');
const assert = require('assert')

const fetchRemote = require('./fetchremote')

// Stored in order. {range: [a,b], urlBase}
const routes = []

const min = (a, b) => a < b ? a : b
const max = (a, b) => a > b ? a : b

const prefixToRange = (prefix) => [prefix, prefix+'~']
function addRoute(range, urlBase) {
  if (typeof range === 'string') range = prefixToRange(range)

  // Splice the route in order in the routes list. Binary tree or something
  // would be good here but there shouldn't be many routes, so this is fine for
  // now.
  const [a, b] = range
  assert(a < b)

  for(let i = 0; i < routes.length; i++) {
    const r = routes[i].range

    if (a > r[1]) continue
    assert(a < r[0] && b < r[0], 'Routes overlap')
    routes.splice(i, 0, {range, urlBase})
    return
  }
  routes.push({range, urlBase})
}

function routeIntersection(a, b) {
  // Assumes [a, b] inclusive.
  const results = []

  let x = a
  // First try to find the route that overlaps with the 
  for(let i = 0; i < routes.length; i++) {
    const r = routes[i]
    if (x > r.range[1]) continue

    // We've found the next route.
    x = max(x, r.range[0])
    const end = min(b, r.range[1])
    results.push({route:r, range:[x, end]})

    if (r.range[1] >= b) break
  }
  return results
}

// Only thing supported right now.
//addRoute(prefixToRange('/root/'), 'http://localhost:5747')

//addRoute(['a', 'z'], 'http://localhost:5747')
addRoute(['a', 'a~'], 'http://localhost:5747')
addRoute(['c', 'k'], 'http://localhost:5747')

//console.log(routes)

//console.log(routeIntersection('a', 'e'))

const getDef = (map, key, fn) => {
  let v = map.get(key)
  if (v == null) {
    v = fn(key)
    map.set(key, v)
  }
  return v
}

function fetch(ranges, versions, callback) {
  // First go through all the ranges and split them out based on our routes.
  let rangesForRoute = new Map
  for (let i = 0; i < ranges.length; i++) {
    const [a,b] = ranges[i]
    routeIntersection(a, b).forEach(({route, range}) => {
      getDef(rangesForRoute, route, () => ([])).push(range)
    })
  }

  console.log('ranges', rangesForRoute)

  const next = afterAll((err, results) => {
    if (err) return callback(err)

    console.log('Got results back', results)

    let minVersion = -1, maxVersion = Infinity
    const data = {}

    for (let i = 0; i < results.length; i++) {
      const r = results[i]
      for (k in r.results) data[k] = r.results[k]
      
      if (minVersion > r.versions[1] || maxVersion < r.versions[0]) {
        // TODO: Non-overlapping versions. For now abort. Later, await the data
        // from the behind server in question via a subscription.
        throw Error('Non-overlapping version data')
      }

      minVersion = max(minVersion, r.versions[0])
      maxVersion = min(maxVersion, r.versions[1])
    }

    callback(null, {results: data, versions: [minVersion, maxVersion]})
  })

  rangesForRoute.forEach((ranges, route) => {
    console.log('target', ranges, versions, route.urlBase)
    fetchRemote(route.urlBase, ranges, versions, null, next())
  })
}

/*
fetch([['a', 'b'], ['e', 'g']], [0, Infinity], (err, results) => {
  console.log(err, results)
})*/


require('http').createServer(require('./hostmiddleware')(fetch, null)).listen(5741)
console.log('listening on 5741')
