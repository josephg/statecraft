const concat = require('concat-stream')
const assert = require('assert')

const {inRange, inRanges, normalizeRanges} = require('./util')

const min = (a, b) => a < b ? a : b
const max = (a, b) => a > b ? a : b

function isEmpty(obj) {
  for (let k in obj) return false
  return true
}

function getSourceForKey(key, schema) {
  for (let i = 0; i < schema.length; i++) { // In order.
    const {range:[s0, s1], source} = schema[i]
    if (key < s0) break
    if (key <= s1) return source
  }
  return null
}

function getSourcesForRange(dest = new Set, range, schema) {
  const [r0, r1] = range

  for (let i = 0; i < schema.length; i++) {
    const {range:[s0, s1], source} = schema[i]
    if (r0 > s1) continue
    if (r1 < s0) break

    dest.add(source)
  }

  return dest
}

function getSourcesForRanges(ranges, schema) {
  const sources = new Set
  for (let i = 0; i < ranges.length; i++) {
    getSourcesForRange(sources, ranges[i], schema)
  }
  return sources
}


function subscriptionStore(currentVersions, schema) {
  currentVersions = currentVersions || {}
  const subscriptions = new Map // Map from listener -> {}

  return {
    // Versions is a range [start, end]. Listening automatically stops at end.
    streamOps(ranges, reqVersions, listener, callback) {
      const versions = {}
      // - Discard versions for sources we don't know
      // - If a source is named at an early version we'll error (we don't have
      // a historical op store)
      // - If a source is named at a future version, don't send to this
      // listener until the version matches the start of the requested range
      // - If a source isn't named, default it to the current version. (??? We
      // need a way to do this but this is sort of a weird / awkward way of
      // expressing that.)
      const sources = getSourcesForRanges(ranges, schema)
      for (let s of sources) {
        // TODO: If the version isn't specified this should actually find the
        // minimum version of docs in the requested range
        const v = currentVersions[s]
        const reqV = (reqVersions && reqVersions[s]) || [v, Infinity]
        const [a, b] = reqV

        if (a < v) {
          // TODO: A million ways to fix this error:
          // - Have a short window MVCC store
          // - Have an op store we can chain query
          // - Client should be allowed to request catchup in this case (not
          // managed here) where we send them an 'op' replacing the doc with
          // the current document.
          return callback(Error('Requested version irretrevably in the past'))
        }

        versions[s] = reqV
      }

      subscriptions.set(listener, {
        ranges,
        versions,
      })

      callback(null, {
        versions,
        cancel() { subscriptions.delete(listener) },
      })
    },

    // txn is a map from key -> {newVal, optional opType, optional op}
    op(txn, opVersions) {
      //console.log('op', txn, opVersions)

      for (s in opVersions) currentVersions[s] = opVersions[s]

      for (let [listener, {ranges, versions}] of subscriptions) {
        // Version stuff. We'll only send the client the operation if at least
        // one of the versions matches on a range that is being listened to.
        
        let foundOne = false
        for (let s in versions) {
          let opv = opVersions[s]
          if (opv == null) continue

          // The subscription version range.
          let [a,b] = versions[s]

          assert(opv >= a)
          if (opv > b) {
            delete versions[s]
          } else {
            foundOne = true
          }
        }

        if (!foundOne) {
          if (isEmpty(versions)) {
            // The subscription has expired.
            console.log('Subscription expired', ranges)
            listener(null)
            subscriptions.delete(listener)
          }
          continue // Ignore op - Non-overlapping versions in subscription.
        }

        // Ok now lets look at the actual keys that were updated...
        let view = null

        for (let [key, data] of txn) {
          // Ignore if not in subscribed ranges
          if (!inRanges(key, ranges)) continue

          // Ignore if version isn't listened to
          const source = getSourceForKey(key, schema)
          assert(source, `No schema information for key ${key}`)

          // Check that at least one of the versions matches
          if (versions[source] == null) continue

          if (view == null) view = {ops: new Map, versions:{}}
          view.ops.set(key, data)
          view.versions[source] = opVersions[source]
        }

        if (view != null) listener(view)
      }
    },
  }
}

module.exports = () => {
  const db = {}
  let v = 0

  const source = require('crypto').randomBytes(12).toString('base64')
  const schema = [{range:['a', 'z'], source:source}]
  const subscriptions = subscriptionStore({[source]: v}, schema)

  const alphabet = "abcdefghijklmnopqrstuvwxyz"
  const gen = () => {
    const char = alphabet[(Math.random() * alphabet.length)|0]

    // Transaction!
    v++
    let cell = db[char]
    if (cell == null) {
      db[char] = {data:1, lastMod:v}
    } else {
      cell.data++
      cell.lastMod = v
    }
    // Transaction ended!

    const txn = new Map([[char, {
      newVal: db[char].data,
      opType: 'inc',
      opData: 1
    }]])
    subscriptions.op(txn, {[source]: v})

    //console.log(db)
  }

  for (let i = 0; i < 100; i++) gen()
  setInterval(gen, 300)


  return {
    source,
    fetch(ranges, versions, callback) {
      normalizeRanges(ranges)

      const vrange = versions[source] || [0, Infinity]

      if (vrange[0] > v) {
        // TODO: Hold the query until the version catches up
        return callback(Error('Version in the future'))
      }

      const results = {}
      let minVersion = -1

      console.log('fetch', ranges, vrange)

      // Start read transaction
      ranges.forEach(([a, b]) => {
        //console.log('range', a, b)
        // Range query from a to b. But we know they're all single letters, so whatevs.
        const aa = a.charCodeAt(0)
        const bb = b.charCodeAt(0)

        for (let i = aa; i <= bb; i++) {
          const c = String.fromCharCode(i)
          const cell = db[c]
          if (!cell) continue
          //console.log('got cell', c, cell)
          minVersion = Math.max(minVersion, cell.lastMod)
          results[c] = cell.data
        }
      })

      callback(null, {results, versions:{[source]: [minVersion, v]}})
    },

    streamOps(ranges, versions, listener, callback) {
      subscriptions.streamOps(ranges, versions, listener, callback)
    },

    /*
    fetchOps(ranges, versions, callback) {
      callback(Error('Ops not available'))
    },
    
    streamDocs() {},

    fetchAndSubscribe() {

    },
*/

  }
}

