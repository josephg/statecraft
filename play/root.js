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
      let diff = null
      for (let k of sub.query) {
        const change = txn.get(k)
        if (!change) continue

        if (diff == null) diff = new Map

        if (sub.options.supportedOps.has(change.opType)) {
          diff.set(k, {type: change.opType, data: change.opData})
        } else {
          diff.set(k, {type: 'set', data: change.newVal})
        }

        sub.data.set(k, change.newVal)
      }

      const vs = sub.versions[source]
      if (diff != null) vs[0] = v
      vs[1] = v

      if (diff != null || sub.options.notifyAll) {
        sub.emit('txn', {data: diff || new Map, versions: sub.versions})
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

      const results = new Map
      let minVersion = -1

      for (let k of docs) {
        const cell = db[k]
        if (cell == null) continue // Is this right? I think this is right..?
        
        results.set(k, cell.data)
        minVersion = Math.max(minVersion, cell.lastMod)
      }

      callback(null, {results, versions:{[source]: [minVersion, v]}})
    },

    subscribeKV(initial, versions, options = {}, listener) {
      //const {Readable} = require('stream')
      const EventEmitter = require('events')
      const type = require('./setops')

      // For now I'm going to ignore the requested versions.
      if (versions[source]) throw Error('Requesting versions not yet supported')

      // Options are:
      // - Supported operation types (supportedOps)
      // - Do initial fetch? (default YES, currently forced YES)
      // - Raw? (If raw then we don't attach a copy of the data. Must be raw if no initial fetch.) (false)
      // - Notify re version bump always? (options.notifyAll)
      // - What to do if there's no ops available from requested version (nyi)
      // - Follow symlinks? (nyi)

      // But none of the options are supported at the moment.
      

      const sub = new EventEmitter()
      /*
      sub.stream = new Readable({
        read(size) {},
        objectMode: true,
      })*/
      sub.query = type.create()
      sub.data = new Map

      options.supportedOps = new Set(options.supportedOps)
      sub.options = options
      sub.versions = {[source]: [0, v], _client: [0, 0]}

      sub.cancel = () => {
        subs.delete(sub)
      }

      subs.add(sub)

      // Modify the subscription with a setop operation
      sub.modify = (op, callback) => {
        // There's a whole bunch of super fun timing issues here.
        const diff = new Map
        let minVersion = sub.versions[source][0]
        if (op.add) op.add.forEach(k => {
          const cell = db[k]
          if (!cell) return

          minVersion = Math.max(minVersion, cell.lastMod)
          diff.set(k, {type: 'set', data: cell.data})
          sub.data.set(k, cell.data)
        })
        if (op.remove) op.remove.forEach(k => {
          const cell = db[k]
          if (!cell) return

          diff.set(k, {type: 'rm'})
          sub.data.delete(k)
        })
        sub.query = type.apply(sub.query, op)

        sub.versions[source][0] = minVersion
        const cv = sub.versions._client
        cv[0] = cv[1] = cv[1] + 1

        sub.emit('txn', {data: diff, versions: sub.versions})
        callback && callback(null, diff, versions)
      }

      if (listener) sub.on('txn', listener)

      // Creating a subscription with a query is shorthand for creating an
      // empty subscription then modifying its query.
      if (initial) sub.modify({add:Array.from(initial)})

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

      console.log('fetchSKV', ranges, vrange)

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

