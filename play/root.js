const concat = require('concat-stream')
const assert = require('assert')

const rangeops = require('./rangeops')

const {arrayCursor, eachInRanges} = require('./rangeutil')

const min = (a, b) => a < b ? a : b
const max = (a, b) => a > b ? a : b


module.exports = () => {
  const db = new Map
  let v = 0

  const source = require('crypto').randomBytes(12).toString('base64')

  //const schema = [{range:['a', 'z'], source:source}]

  // It should be a map from key -> sub, but for this prototype I'll just scan all the subscriptions.
  const subs = new Set

  function notifySubs(txn, v) {
    for (let sub of subs) {
      let diff = null
      sub._filterTxn(txn, (k) => {
        const change = txn.get(k)
        if (!change) return

        if (diff == null) diff = new Map

        if (sub.opts.supportedTypes.has(change.type)) {
          diff.set(k, {type: change.type, data: change.data})
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

    // Modify the db. txn is a map from key => {type, data}. versions is just source => v.
    mutate(txn, versions, options = {}, callback) {
      // I'm convinced there's some more parameters we should be passing to
      // mutate, but I'm not sure what they are.
      //
      // At the very least I'll probably need the client to be more specific
      // about whether transforms are allowed. I think?
      //
      // TODO: add txn metadata (source, etc)

      // Options:
      // - Additional keys that we should conflict with if they've changed
      //   since the named version. This could be implemented with noops in the
      //   txn, though thats kind of nasty. NYI.

      // First check the versions.
      const opv = versions[source]
      if (opv != null && opv < v) {
        // Version is old. Check all the modified keys to see if we actually conflict with anything.
        for (let k of db.keys()) {
          const cell = db.get(k)
          if (cell && cell.lastMod > v) {
            return callback && callback(Error('Write conflict - txn out of date'))
          }
        }
        // TODO: Also check options.conflictKeys.
      }

      // TODO: Also check operations are valid - which is to say, the types are
      // legit and any check() functions run successfully.

      // TODO: Give operation ID, timestamp. Do operation dedup detection.

      // ***** Ok, transaction going ahead.
      v++

      const {applyOne} = require('./resultset')
      for (let [k, op] of txn) {
        let cell = db.get(k)
        if (cell == null) db.set(k, (cell = {}))

        const result = applyOne(cell ? cell.data : null, op)
        // If the result is undefined we still need to keep the cell to store
        // the lastMod value.
        //
        // This can be purged later, when the named op is forgotten to history.
        cell.data = result
        cell.lastMod = v

        // This is added to the transaction so clients which don't understand
        // the op type can still subscribe.
        op.newVal = result
      }

      notifySubs(txn, v)

      if (callback) process.nextTick(() => callback(null, v))
    },

    // Fetch for sorted key values. The query is a range op object.
    fetchSKV(ranges, versions, callback) {
      const vrange = versions[source] || [0, Infinity]

      if (vrange[0] > v) {
        // TODO: Hold the query until the version catches up
        return callback(Error('Version in the future'))
      }
      if (vrange[1] < v) {
        // TODO: Add operation cache.
        return callback(Error('Version too old'))
      }

      const results = new Map
      let minVersion = -1

      //console.log('fetchSKV', ranges, vrange)

      // Start read transaction
      eachInRanges(ranges, db.keys(), c => {
        const cell = db.get(c)
        if (!cell) return
        //console.log('got cell', c, cell)
        minVersion = max(minVersion, cell.lastMod)
        if (cell.data !== undefined) results.set(c, cell.data)
      })

      //console.log('results', results)

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

    subscribeSKV(initialQuery, versions, opts = {}, listener, callback) {
      // TODO: The query needs a skip and a limit
      const type = rangeops
      const sub = this._sub(type, versions, opts, listener, callback)

      sub.modify = (op, newCV, callback) => {
        console.log('sub.modify', op, newCV)
        if (typeof newCV === 'function') [newCV, callback] = [null, newCV]
  
        const diff = new Map
        let minVersion = sub.versions[source][0]

        // TODO: This is janky because right now its just looking at whether
        // the number is increased or decreased, not which items have been
        // added and removed from the query ranges. Pretty fixable though, just
        // need a bit more plumbing.
        
        eachInRanges(op, db.keys(), (k, v) => {
          // v is 1 if a range is being added, -1 if its being removed.
          const cell = db.get(k)
          if (!cell) return

          if (v > 0) {
            minVersion = max(minVersion, cell.lastMod)
            if (cell.data !== undefined) {
              diff.set(k, {type:'set', data:cell.data})
              // TODO: Could use result ops to modify sub.data.
              if (!sub.opts.raw) sub.data.set(k, cell.data)
            }
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

      sub.modify(initialQuery, sub.opts.cv || 0, callback)

      return sub
    }
  }
}

