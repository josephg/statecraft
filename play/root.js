const concat = require('concat-stream')
const assert = require('assert')

const {inRange, inRanges, normalizeRanges} = require('./util')

const min = (a, b) => a < b ? a : b
const max = (a, b) => a > b ? a : b

function isEmpty(obj) {
  for (let k in obj) return false
  return true
}


function subscriptionStore(currentVersions) {
  currentVersions = currentVersions || {}
  const subscriptions = new Map // Map from listener -> {}

  return {
    // txn is a map from key -> {newVal, optional opType, optional op}
    op(txn, opVersions) {
      //console.log('op', txn, opVersions)

      for (s in opVersions) currentVersions[s] = opVersions[s]

      for (let [listener, {ranges, versions}] of subscriptions) {
        // If none of the versions overlap, ignore.
        let foundOne = false
        for (let s in versions) {
          let opv = opVersions[s]
          if (opv == null) continue

          // This is the subscription version range.
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
          continue
        }


        let view = null

        for (let [key, data] of txn) {
          if (inRanges(key, ranges)) {
            if (view == null) view = new Map

            view.set(key, data)
          }
        }

        if (view != null) listener(view)
      }
    },

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
      for (k in currentVersions) {
        const v = currentVersions[k]
        const reqV = (reqVersions && reqVersions[k]) || [v, Infinity]
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

        versions[k] = reqV
      }

      subscriptions.set(listener, {
        ranges,
        versions,
      })

      callback(null, {
        versions,
        cancel() { subscriptions.delete(listener) },
      })
    }
  }
}

module.exports = () => {
  const db = {}
  let v = 0

  const subscriptions = subscriptionStore()
  const source = require('crypto').randomBytes(12).toString('base64')
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

