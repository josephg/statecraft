const concat = require('concat-stream')
const assert = require('assert')

const rangeops = require('./rangeops')

const {arrayCursor, eachInRanges} = require('./rangeutil')

//const {inRange, inRanges, normalizeRanges} = require('./util')

const min = (a, b) => a < b ? a : b
const max = (a, b) => a > b ? a : b



module.exports = () => {
  const db = {} // Map from key -> value.
  let v = 0

  const source = require('crypto').randomBytes(12).toString('base64')

  //const schema = [{range:['a', 'z'], source:source}]
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
      sub._filterTxn(txn, (k) => {
        const change = txn.get(k)
        if (!change) return

        if (diff == null) diff = new Map

        if (sub.opts.supportedTypes.has(change.opType)) {
          diff.set(k, {type: change.opType, data: change.opData})
        } else {
          diff.set(k, {type: 'set', data: change.newVal})
        }

        if (!sub.opts.raw) sub.data.set(k, change.newVal)
      })

      const vs = sub.versions[source]
      if (diff != null) vs[0] = v
      vs[1] = v

      if (diff != null || sub.opts.notifyAll) {
        process.nextTick(() => sub.emit('txn', diff || new Map, sub.versions))
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

      process.nextTick(() => callback(null, {results, versions:{[source]: [minVersion, v]}}))
    },

    _sub(type, versions, opts = {}, listener) {
      const EventEmitter = require('events')

      // For now I'm going to ignore the requested versions.
      if (versions[source]) throw Error('Requesting versions not yet implemented')

      // Options are:
      // - Supported operation types (opts.supportedTypes)
      // - Do initial fetch? (NYI, forced YES)
      // - Raw? (If raw then we don't attach a copy of the data. Must be raw if no initial fetch.) (false)
      // - Notify re version bump always? (opts.notifyAll)
      // - What to do if there's no ops available from requested version (nyi)
      // - Follow symlinks? (NYI)

      const sub = new EventEmitter()

      sub._type = type
      sub._query = type.create() // Private
      sub.data = opts.raw ? null : new Map

      opts.supportedTypes = new Set(opts.supportedTypes)
      sub.opts = opts

      sub.versions = {[source]: [0, v], _client: [-1, -1]}

      sub.cancel = () => {
        subs.delete(sub)
      }

      subs.add(sub)

      // MUST BE OVERRIDDEN.
      sub.modify = (op, newCV, callback) => { throw Error('Not overridden by implementor') }

      if (listener) sub.on('txn', listener)
      return sub
    },

    subscribeKV(initial, versions, opts, listener, callback) {
      const type = require('./setops')
      const sub = this._sub(type, versions, opts, listener, callback)

      // Modify the subscription with a setop operation
      sub.modify = (op, newCV, callback) => {
        if (typeof newCV === 'function') [newCV, callback] = [null, newCV]

        const diff = new Map
        let minVersion = sub.versions[source][0]
        if (op.add) op.add.forEach(k => {
          const cell = db[k]
          if (!cell) return

          minVersion = Math.max(minVersion, cell.lastMod)
          diff.set(k, {type: 'set', data: cell.data})
          if (!sub.opts.raw) sub.data.set(k, cell.data)
        })
        if (op.remove) op.remove.forEach(k => {
          const cell = db[k]
          if (!cell) return

          // Note that I don't need to set minVersion here. Actually the min /
          // max versions might be overly tight at this point after some keys
          // have been removed, but thats in spec.
          diff.set(k, {type: 'rm'})
          if (!sub.opts.raw) sub.data.delete(k)
        })
        sub._query = type.apply(sub._query, op)

        sub.versions[source][0] = minVersion
        const cv = sub.versions._client
        newCV = newCV == null ? cv[1] + 1 : newCV
        cv[0] = cv[1] = newCV

        callback && process.nextTick(() => callback(null, newCV))
        process.nextTick(() => sub.emit('txn', diff, sub.versions))
      }

      sub._filterTxn = (txn, fn) => {
        for (let k of sub._query) {
          if (txn.has(k)) fn(k)
        }
      }

      // Creating a subscription with a query is shorthand for creating an
      // empty subscription then modifying its query.
      sub.modify({add:Array.from(initial)}, sub.opts.cv || 0, callback)

      return sub
    },

    // Is this important?
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


    // Fetch for sorted key values. The query is a range op object.
    fetchSKV(ranges, versions, callback) {
      const vrange = versions[source] || [0, Infinity]

      if (vrange[0] > v) {
        // TODO: Hold the query until the version catches up
        return callback(Error('Version in the future'))
      }

      const results = new Map
      let minVersion = -1

      //console.log('fetchSKV', ranges, vrange)

      // Start read transaction
      eachInRanges(ranges, alphabet, c => {
        const cell = db[c]
        if (!cell) return
        //console.log('got cell', c, cell)
        minVersion = Math.max(minVersion, cell.lastMod)
        results.set(c, cell.data)
      })

      //console.log('results', results)

      process.nextTick(() => callback(null, {results, versions:{[source]: [minVersion, v]}}))
    },

    subscribeSKV(initial, versions, opts = {}, listener, callback) {
      const type = rangeops
      const sub = this._sub(type, versions, opts, listener, callback)

      sub.modify = (op, newCV, callback) => {
        if (typeof newCV === 'function') [newCV, callback] = [null, newCV]
  
        const diff = new Map
        let minVersion = sub.versions[source][0]

        // *******
        // Now the actually changed part from subscribeKV.
        //
        // TODO: This is janky because right now its just looking at whether
        // the number is increased or decreased, not which items have been
        // added and removed from the query ranges. Pretty fixable though, just
        // need a bit more plumbing.
        
        eachInRanges(op, alphabet, (k, v) => {
          // v is 1 if a range is being added, -1 if its being removed.
          const cell = db[k]
          if (!cell) return

          if (v > 0) {
            minVersion = Math.max(minVersion, cell.lastMod)
            diff.set(k, {type:'set', data:cell.data})
            // TODO: Could use result ops to modify sub.data.
            if (!sub.opts.raw) sub.data.set(k, cell.data)
          } else {
            diff.set(k, {type:'rm'})
            if (!sub.opts.raw) sub.data.delete(k)
          }
        })

        sub._query = type.apply(sub._query, op)
        sub.versions[source][0] = minVersion
        const cv = sub.versions._client
        newCV = newCV == null ? cv[1] + 1 : newCV
        cv[0] = cv[1] = newCV

        callback && process.nextTick(() => callback(null, newCV))
        process.nextTick(() => sub.emit('txn', diff, sub.versions))
      }

      sub._filterTxn = (txn, fn) => {
        eachInRanges(sub._query, txn.keys(), fn)
      }

      sub.modify(initial, sub.opts.cv || 0, callback)

      return sub
    }

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

