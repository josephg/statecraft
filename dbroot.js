const debug = require('debug')('statecraft')
const concat = require('concat-stream')
const assert = require('assert')
const msgpack = require('msgpack-lite')
const eachAsync = require('each-async')
const lmdb = require('node-lmdb')
const fs = require('fs')
const EventEmitter = require('events')

const rangeops = require('./rangeops')

const {applyOne} = require('./resultset')
const {arrayCursor, eachInRanges} = require('./rangeutil')

const min = (a, b) => a < b ? a : b
const max = (a, b) => a > b ? a : b


const CONFIG_KEY = Buffer.from('\x01statecraft')
//const V_KEY = '\x01v'
const TXN_PREFIX = Buffer.from('\x01txn')
const TXN_MAX_KEY = Buffer.from('\x01txn\xff')
//const OP_BUF = Buffer.from('\x01op12345678') // Space for 8 bytes of version number

// The version is too small & hot to bother encoding using msgpack.
function decodeVersion(buffer) {
  // There is no readuint64. (Well actually we need readuint56)
  // I don't expect this prototype to last long enough to see 4 billion
  // operations anyway, so who's counting...
  return buffer.readUInt32LE(TXN_PREFIX.length);
}

function makeTxnKey(v) {
  const buffer = Buffer.allocUnsafe(TXN_PREFIX.length + 8)
  TXN_PREFIX.copy(buffer)
  buffer.writeUInt32LE(v, TXN_PREFIX.length);
  buffer.writeUInt32LE(0, TXN_PREFIX.length + 4);
  return buffer;
}

const isTxnKey = (k) => k.length >= TXN_PREFIX.length && TXN_PREFIX.compare(k, 0, TXN_PREFIX.length) === 0
assert(isTxnKey(TXN_PREFIX))
assert(isTxnKey(TXN_MAX_KEY))
assert(!isTxnKey(CONFIG_KEY))
assert(!isTxnKey(Buffer.from('\x01tx')))

const asBuf = (x) => x == null ? null : Buffer.isBuffer(x) ? x : Buffer.from(x)

const doNothing = () => {}

// This is so we can use rangeutil's eachInRanges
function wrapLMDBCursor(cursor) {
  // node-lmdb's cursor is super sloppy.
  let ended = cursor.goToFirst() == null
  return {
    skip(k) {
      // Skip to k or the next available key if thats not available.
      //console.log('skip', k, ended)
      // We need to convert the key to a buffer because node-lmdb bizzarrely encodes strings in UTF-16.
      const _k = cursor.goToKey(asBuf(k))
      //console.log('result', _k)
      if (_k == null) this.next()
    },
    peek() {
      //console.log('peek', ended)
      if (ended) return null

      let entry
      cursor.getCurrentBinary((k, v) => entry = [k.toString(), v]) // TODO: String keys vs binary keys??
      return entry
    },
    next() {
      //console.log('next')
      ended = (cursor.goToNext() == null)
      //console.log('ended', ended)
    }

  }
}

class Subscription extends EventEmitter {
  constructor(store, type, opts, versions, listener) {
    super()
    console.log('a')
  
    // Options are:
    // - Supported operation types (opts.supportedTypes)
    // - Do initial fetch? (NYI, forced YES)
    // - Raw? (If raw then we don't attach a copy of the data. Must be raw if no initial fetch.) (false)
    // - Notify re version bump always? (opts.notifyAll)
    // - What to do if there's no ops available from requested version (nyi)
    // - Follow symlinks? (NYI)

 
    // For now I'm going to ignore the requested versions.
    if (versions[store.source]) throw Error('Requesting versions not yet implemented')

    this._type = type
    this._query = type.create() // Private
    this.data = opts.raw ? null : new Map

    opts.supportedTypes = new Set(opts.supportedTypes)
    this.opts = opts

    this.versions = {[store.source]: [0, store.version], _client: [-1, -1]}

    this.cancel = () => {
      store.subs.delete(this)
    }

    if (listener) this.on('txn', listener)
  }

  // Override me.
  modify(op, newCV, callback) { throw Error('Not overridden by implementor') }
}

class Store {
  close() {
    this._snapDb.close()
    this._txnDb.close()
    this._env.close()
  }

  constructor(location, options = {}) {
    if (!location || typeof location === 'object') throw Error('Invalid location');

    this._env = new lmdb.Env()

    // Check that the directory exists.
    try { fs.mkdirSync(location) }
    catch(e) { if (e.code !== 'EEXIST') throw e }

    this._env.open({
      path: location,
      maxDbs: 2,
      noTls: true, // No thread-local storage. LMDB is designed for a threaded environment.
    })
    // TODO: pass db opts from options

    const snapDb = this._snapDb = this._env.openDbi({name:'snapshots', create:true})
    const txnDb = this._txnDb = this._env.openDbi({name:'txns', create:true})

    // Now we need to initialize. Specifically we need to fetch the configuration and find which version we're at.

    //this.lock = require('lock')();

    /*
    {
      const txn = this._env.beginTxn()
      txn.putBinary(txnDb, makeTxnKey(0), Buffer.from("hi there"))
      txn.commit()
    }*/

    const txn = this._env.beginTxn()
    let config = txn.getBinary(snapDb, CONFIG_KEY)
    this.version = 0

    if (config == null) {
      // New database! Init!
      const sourceBytes = require('crypto').randomBytes(12)
      this.source = sourceBytes.toString('base64')
      txn.putBinary(snapDb, CONFIG_KEY, msgpack.encode({sc_ver:1, source: sourceBytes}))
      debug(`Initialized a new database ${this.source} at version 0`)
    } else {
      // Ok, the database already exists. Find the most recent op so we know what the version is.
      const cursor = new lmdb.Cursor(txn, txnDb)
      cursor.goToKey(TXN_MAX_KEY)
      if ((cursor.goToPrev())) {
        // Its a shame we have to read the whole transaction here, but whatever. Its init code.
        cursor.getCurrentBinary((key, _) => {
          // Check if the key is actually a transaction
          if (key == null || !isTxnKey(key)) return
          this.version = decodeVersion(key) + 1
        })
      }
      config = msgpack.decode(config)
      assert.equal(config.sc_ver, 1)
      this.source = config.source.toString('base64')
      cursor.close()

      debug(`Initialized existing database ${this.source} at version ${this.version}`)
    }
    txn.commit()

    // TODO: It should probably be a map from key -> sub, but for now I'll just scan all the subscriptions.
    this.subs = new Set
  }

  _whenReady(fn) {
    // There will come a time when I need this, but it is not this day.
    fn()
    //this.ready.then(db => fn(null, db), err => fn(err));
  }

  _notifySubs(txn, v) {
    for (let sub of this.subs) {
      let diff = null
      sub._filterTxn(txn, ([k, op]) => {
        if (!op) return

        if (diff == null) diff = new Map

        if (sub.opts.supportedTypes.has(op.type)) {
          diff.set(k, {type: op.type, data: op.data})
        } else {
          diff.set(k, {type: 'set', data: op.newVal})
        }

        if (!sub.opts.raw) sub.data.set(k, op.newVal)
      })

      const vs = sub.versions[this.source]
      if (diff != null) vs[0] = v
      vs[1] = v

      if (diff != null || sub.opts.notifyAll) {
        process.nextTick(() => sub.emit('txn', diff || new Map, sub.versions))
      }
    }
  }
  
  // Modify the db. txn is a map from key => {type, data}. versions is just source => v.
  mutate(txn, versions, options = {}, callback = doNothing) {
    // I'm convinced there's some more parameters we should be passing to
    // mutate, but I'm not sure what they are.
    //
    // At the very least I'll probably need the client to be more specific
    // about whether transforms are allowed.
    //
    // TODO: add txn metadata (source, etc). Give it an ID, timestamp.
    // TODO: Do operation dedup detection.

    // Options:
    // - Additional keys that we should conflict with if they've changed
    //   since the named version. This could be implemented with noops in the
    //   txn, though thats kind of nasty. NYI.
    // - Are transactions allowed? ???

    // Go through the transaction, modifying, checking versions and adding to the batch.
    const opv = versions[this.source] != null ? versions[this.source] : this.version
    if (opv > this.version) return callback('Requested op version in the future')

    const dbTxn = this._env.beginTxn()

    // The transaction to store in the database.
    const txnOut = {} // msgpack-lite can't encode Maps. I could set up a custom codec ... :/

    // TODO: Also check options.conflictKeys.
    for (let [k, op] of txn) {
      //console.log('txn', k, op)
      const kbuf = asBuf(k)
      if (kbuf[0] === 1) { dbTxn.abort(); return callback(Error('Cannot access reserved keyspace')) }

      const oldVal = dbTxn.getBinary(this._snapDb, kbuf)

      let lastMod, data
      if (oldVal != null) [lastMod, data] = msgpack.decode(oldVal)
      else [lastMod, data] = [-1, null]

      //console.log('Current data', lastMod, data, 'opv', opv, 'lastmod', lastMod)
      if (opv <= lastMod) { dbTxn.abort(); return callback(Error('Write conflict - txn out of date')) }

      // TODO: Also check operations are valid - which is to say, the types are
      // legit and any check() functions run successfully.
      const result = applyOne(data, op)
      //console.log('->', result)
      // If the result is null (which is to say, the document got deleted)
      // we still need to keep the placeholder around until the
      // corresponding version falls off the edge of recorded history.
      dbTxn.putBinary(this._snapDb, kbuf, msgpack.encode([this.version, result]))

      // This is mostly for clients which don't have the op type - so they
      // can still meaningfully subscribe.
      // TODO: Reconsider this. This is a performance penalty in many
      // cases. Probably take it out if its a set: operation at the very
      // least. Should be configurable.
      op.newVal = result

      txnOut[k] = op
    }

    // TODO: Give transaction ID, timestamp.
    dbTxn.putBinary(this._txnDb, makeTxnKey(this.version), msgpack.encode(txnOut))

    // This is the point of no return.
    dbTxn.commit()

    const txnv = this.version
    this.version++
    this._notifySubs(txn, this.version)

    // TODO: Should I return the version the txn was accepted or the resulting version of the database?
    process.nextTick(() => callback(null, txnv))
  }

  // Fetch for sorted key values. The query is a range op object.
  fetchSKV(ranges, versions, callback) {
    const vrange = versions[this.source] || [0, Infinity]

    if (vrange[0] > this.version) {
      // TODO: Hold the query until the version catches up?
      return callback(Error('Version in the future'))
    }
    /*
    if (vrange[1] < this.version) {
      // TODO: Add operation cache.
      return callback(Error('Version too old'))
    }*/

    const results = new Map
    let minVersion = -1

    //console.log('fetchSKV', ranges, vrange)

    const dbTxn = this._env.beginTxn({readOnly:true})
    const cursor = new lmdb.Cursor(dbTxn, this._snapDb)
    // Start read transaction
    //console.log('er', ranges)
    eachInRanges(ranges, wrapLMDBCursor(cursor), ([k, cell]) => {
      //console.log('EIR', k, cell)
      const [lastMod, data] = msgpack.decode(cell)
      if (lastMod > vrange[1]) { // TODO: > or >=?
        cursor.close(); dbTxn.abort();
        return callback(Error('Version too old'))
      }

      minVersion = max(minVersion, lastMod)
      if (data !== null) results.set(k, data)
    })

    //console.log('results', results)

    cursor.close()
    dbTxn.commit() // Its a readonly transaction - I assume commit and abort are the same

    process.nextTick(() => callback(null, {results, versions:{[this.source]: [minVersion, this.version]}}))
  }

  subscribeSKV(initialQuery, versions, opts = {}, listener, callback) {
    // TODO: The query needs a skip and a limit
    const type = rangeops
    const sub = new Subscription(this, type, opts, versions, listener)

    // Modify the subscription by modifying the query.
    sub.modify = (op, newCV, callback) => {
      //console.log('sub.modify', op, newCV)
      if (typeof newCV === 'function') [newCV, callback] = [null, newCV]

      const diff = new Map
      let minVersion = sub.versions[this.source][0]

      const dbTxn = this._env.beginTxn({readOnly:true})
      const cursor = new lmdb.Cursor(dbTxn, this._snapDb)
      // TODO: This is janky because right now its just looking at whether
      // the number is increased or decreased, not which items have been
      // added and removed from the query ranges. Pretty fixable though, just
      // need a bit more plumbing.
      eachInRanges(op, wrapLMDBCursor(cursor), ([k, cell], val) => {
        // val is 1 if a range is being added, -1 if its being removed.
        //const cell = db.get(k)
        //if (!cell) return
        const [lastMod, data] = msgpack.decode(cell)

        if (val > 0) { // Add to range.
          minVersion = max(minVersion, lastMod)
          if (data != null) {
            diff.set(k, {type:'set', data:data})
            // TODO: Could use result ops to modify sub.data.
            if (!sub.opts.raw) sub.data.set(k, data)
          }
        } else { // Remove.
          diff.set(k, {type:'rm'})
          if (!sub.opts.raw) sub.data.delete(k)
        }
      })
      cursor.close()
      dbTxn.commit()

      sub._query = type.apply(sub._query, op)
      sub.versions[this.source][0] = minVersion
      const cv = sub.versions._client
      newCV = newCV == null ? cv[1] + 1 : newCV
      cv[0] = cv[1] = newCV

      callback && process.nextTick(() => callback(null, newCV))
      process.nextTick(() => sub.emit('txn', diff, sub.versions))
    }

    sub._filterTxn = (txn, fn) => {
      eachInRanges(sub._query, txn.entries(), fn)
    }

    sub.modify(initialQuery, sub.opts.cv || 0, callback)
    this.subs.add(sub)

    return sub
  }
}

module.exports = (location, options) => new Store(location, options)


if (require.main === module) {
  const store = new Store('db', {db: require('leveldown')});

  store._whenReady(() => {
    
  const sub = store.subscribeSKV(['<a', 1, '>c'], {},
      {supportedTypes:['inc'], notifyAll:false}, function(data, versions) {
    console.log('txn', data, versions)
    console.log('data result', this.data)
  })
 
  setInterval(() => {
    store.mutate(new Map([['a', {type:'inc', data:1}]]), {[store.source]:store.version}, {}, (err, v) => {
      if (err) throw err
      console.log('operation accepted at', v)
    })
  }, 500)

  
  setTimeout(() => {
    console.log('modifying subscription')
    sub.modify(['<c', -1, '.', 0, '<z', 1, '.'], (err, newData) => {
      console.log('subscription modified', newData)
    })
  }, 3000)

    /*
    store.fetchSKV(['<a', 1, '>c'], {}, (err, results) => {
      console.log('fetchskv', err, results)
    })*/

    /*
    const txn = new Map([['a', {type:'set', data:1000}], ['c', {type:'set', data:'hi'}]])
    store.mutate(txn, {[store.source]:store.version}, {}, (err, v) => {
      if (err) throw err
      console.log('operation accepted at', v)

     

      store.mutate(new Map([['a', {type:'inc', data:1}]]), {[store.source]:v+1}, {}, (err, v) => {
        if (err) throw err
        console.log('operation accepted at', v)
      })
    })*/
  })

  /*
  store.set('/foo/bar', {x:5}, (err) => {
    if (err) console.error(err);

    store.get('/foo/bar', (err, data, v) => {
      console.log('got data', data, 'at version', v, 'type', typeof(data));
    });
  });*/
}
