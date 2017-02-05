const concat = require('concat-stream')
const assert = require('assert')

const {inRange, inRanges, normalizeRanges} = require('./util')

const min = (a, b) => a < b ? a : b
const max = (a, b) => a > b ? a : b


module.exports = () => {
  const db = {} // Map from key -> value.
  let v = 0

  const source = require('crypto').randomBytes(12).toString('base64')
  const schema = [{range:['a', 'z'], source:source}]
  //const subscriptions = require('./simplesubscriptions')({[source]: v}, schema)

  // It should be a map from key -> sub, but for this prototype I'll just scan all the subscriptions.
  const subs = new Set

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

    notifySubs(txn, v)
    //subscriptions.op(txn, {[source]: v})

    //console.log(db)
  }

  for (let i = 0; i < 100; i++) gen()
  setInterval(gen, 300)

  function notifySubs(txn, v) {
    for (let sub of subs) {
      let notify = null
      for (let k of sub.query) {
        if (!txn.has(k)) continue

        if (notify == null) notify = new Map
        notify.set(k, txn.get(k))
        sub.data.set(k, txn.get(k).newVal)
      }

      if (notify != null) {
        sub.versions[source] = [v, v]
      } else {
        sub.versions[source][1] = v
      }

      if (notify != null || sub.options.notifyAll) {
        sub.emit('txn', notify || new Map, {[source]: v})
      }
    }

  }


  return {
    source,

    // Fetch for plain KV pairs.
    fetchKV(docs, versions, callback) {
      // Since any store that supports SVK supports KV, we should be able to
      // have a generic fallback to SVK that'll work here. But I'll write that
      // later.
      
      // docs should be a json set.
      if (Array.isArray(docs)) docs = new Set(docs)

      const vrange = versions[source] || [0, Infinity]
      if (vrange[0] > v) {
        // TODO: Hold the query until the version catches up. Or something???
        return callback(Error('Version in the future'))
      }

      const results = {} // ugh this should be a map.
      let minVersion = -1

      for (let k of docs) {
        const cell = db[k]
        if (cell == null) continue // Is this right? I think this is right..?
        
        results[k] = cell.data
        minVersion = Math.max(minVersion, cell.lastMod)
      }

      callback(null, {results, versions:{[source]: [minVersion, v]}})
    },

    subscribeKV(initial, versions, options = {}) {
      //const {Readable} = require('stream')
      const EventEmitter = require('events')
      const type = require('./setops')

      // For now I'm going to ignore the requested versions.
      if (versions[source]) throw Error('Requesting versions not yet supported')

      // Options are:
      // - Supported operation types (forced ALL)
      // - Do initial fetch? (default YES, currently forced YES)
      // - Raw? (If raw then we don't attach a copy of the data. Must be raw if no initial fetch.) (false)
      // - Notify re version bump always? (options.notifyAll)
      // - What to do if there's no ops available from requested version (nyi)
      // - Follow symlinks? (nyi)

      // But none of the options are supported at the moment.
      
      const query = type.create(initial)

      const sub = new EventEmitter()
      /*
      sub.stream = new Readable({
        read(size) {},
        objectMode: true,
      })*/
      sub.query = query
      sub.data = null
      sub.options = options
      sub.clientVersion = 0
      sub.modify = (op, callback) => {
        // There's a whole bunch of super fun timing issues here.
        const newData = {}
        if (op.add) op.add.forEach(k => {
          const cell = db[k]
          if (!cell) return

          sub.data.set(k, newData[k] = cell.data)
          sub.versions[source][0] = Math.max(sub.versions[source][1], cell.lastMod)
        })
        if (op.remove) op.remove.forEach(k => {
          sub.data.delete(k)
        })
        sub.query = type.apply(query, op)
        sub.clientVersion++

        callback && callback(null, newData)
      }

      sub.cancel = () => {
        subs.delete(sub)
      }

      subs.add(sub)

      // Mmmm we should fetch the data async, but there's weird timing
      // implications of doing that here because all the client version changes
      // need to be ordered. Ehhhhhhhh its going to be janky.
      sub.data = new Map
      let minVersion = -1
      query.forEach(k => {
        let cell = db[k]
        if (cell == null) return
        sub.data.set(k, cell.data)
        minVersion = Math.max(minVersion, cell.lastMod)
      })
      sub.versions = {[source]: [minVersion, v]}
      process.nextTick(() => sub.emit('ready', sub.data))

      return sub
    },

    




    simpleSubKV(query, versions, listener, callback) {
      const sub = this.subscribeKV(query, versions || {}, {})
      sub.on('ready', () => {
        callback(null, {
          versions: sub.versions,
          cancel() { sub.cancel() },
        })
      })
      sub.on('txn', listener)
    },

    // Fetch for sorted key values
    fetchSKV(ranges, versions, callback) {
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


    /*
    streamOpsSVK(ranges, versions, listener, callback) {
      subscriptions.streamOpsSVK(ranges, versions, listener, callback)
    },*/

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

