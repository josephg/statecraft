// A POC database built on top of lmdb. This is a little bit cheating because
// the lmdb wrapper I'm using is syncronous, so I don't have to do some of the
// challenging work that you would have to do to interoperate with a different
// data store.

const debug = require('debug')('statecraft')
const concat = require('concat-stream')
const assert = require('assert')
const msgpack = require('msgpack-lite')
const eachAsync = require('each-async')
const lmdb = require('node-lmdb')
const fs = require('fs')
const EventEmitter = require('events')

const queryops = require('../common/queryops')

const subStore = require('./sub')

const {applyOne} = require('./resultset').type
const rangeutil = require('./rangeutil')

const min = (a, b) => a < b ? a : b
const max = (a, b) => a > b ? a : b


const CONFIG_KEY = Buffer.from('\x01statecraft')
//const V_KEY = '\x01v'
const TXN_PREFIX = Buffer.from('txn')
const TXN_MAX_KEY = Buffer.from('txn\xff')
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
      // We need to convert the key to a buffer because node-lmdb bizzarrely encodes strings in UTF-16.
      const _k = cursor.goToKey(asBuf(k))
      if (_k == null) this.next()
    },
    peek() {
      if (ended) return null

      let entry
      cursor.getCurrentBinary((k, v) => entry = [k.toString(), v]) // TODO: String keys vs binary keys??
      return entry
    },
    next() {
      ended = (cursor.goToNext() == null)
    }

  }
}

class Store {
  close() {
    this._snapDb.close()
    this._txnDb.close()
    this._env.close()
  }

  get supportedQueryTypes() { return {sortedkv:true} }

  constructor(location = 'db', options = {}) {
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
      txn.putBinary(snapDb, CONFIG_KEY, msgpack.encode({sc_ver:1, source: sourceBytes, min_ver:0}))
      debug(`Initialized a new database ${this.source} at version 0`)

      this.minVersion = 0
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
      this.minVersion = config.min_ver || 0 // Updated when we purge old records
      cursor.close()

      debug(`Initialized existing database ${this.source} at version ${this.version}`)
    }
    txn.commit()

    const subfns = subStore(this.supportedQueryTypes, this.fetch.bind(this))
    this.subscribe = subfns.subscribe
    this._notifySubs = subfns.onOp
  }

  _whenReady(fn) {
    // There will come a time when I need this, but it is not this day.
    fn()
    //this.ready.then(db => fn(null, db), err => fn(err));
  }
  
  _notify(txn, v) {
    this._notifySubs(this.source, v, txn)
  }

  // Modify the db. txn is a map from key => {type, data}. versions is just source => v.
  // TODO: Consider adding a txnType argument here as well.
  //
  // # On versions:
  // 
  // The version specified here is the current expected database version. The
  // transaction itself will have a version equal to the new database version,
  // which will be greater.
  //
  // The version can be elided if you don't care what the database has when the
  // operation is submitted.
  //
  // So for example, given db at version 10, mutate(v:10) => transaction at
  // v:11, and afterwards db is at v:11.
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
    const expectv = versions[this.source] != null ? versions[this.source] : this.version
    assert(typeof(expectv) === 'number')

    // TODO: Not sure if I actually want this check.
    if (expectv > this.version) return callback('Requested op version in the future')
    if (expectv < this.minVersion) return callback('Operation too old for database') // TODO: < or <= ?

    const dbTxn = this._env.beginTxn()

    // The transaction to store in the database.
    const txnOut = {} // msgpack-lite can't encode Maps. I could set up a custom codec ... :/

    // TODO: Also check options.conflictKeys.
   
    // The actual version the transaction will be at, if the transaction is accepted.
    const txnv = this.version + 1

    for (let [k, docop] of txn) {
      //console.log('txn', k, docop)
      const kbuf = asBuf(k)
      if (kbuf[0] === 1) { dbTxn.abort(); return callback(Error('Cannot access reserved keyspace')) }

      const oldVal = dbTxn.getBinary(this._snapDb, kbuf)

      let lastMod, data
      if (oldVal != null) [lastMod, data] = msgpack.decode(oldVal)
      else [lastMod, data] = [0, null] // Op 0 sort of implicitly set all values in the db to null.

      //console.log('reqv', reqv, 'txnv', txnv, 'lastmod', lastMod)
      //console.log('Current data', lastMod, data, 'opv', opv, 'lastmod', lastMod)
      if (expectv < lastMod) { dbTxn.abort(); return callback(Error('Write conflict - txn out of date')) }

      // TODO: Also check operations are valid - which is to say, the types are
      // legit and any check() functions run successfully.
      const result = applyOne(data, docop)
      //console.log('->', result)
      // If the result is null (which is to say, the document got deleted)
      // we still need to keep the placeholder around until the
      // corresponding version falls off the edge of recorded history.
      dbTxn.putBinary(this._snapDb, kbuf, msgpack.encode([txnv, result]))

      // This is mostly for clients which don't have the op type - so they
      // can still meaningfully subscribe.
      // TODO: Reconsider this. This is a performance penalty in many
      // cases. Probably take it out if its a set: operation at the very
      // least. Should be configurable.
      if (docop.type !== 'set') docop.newVal = result

      txnOut[k] = docop
    }

    // TODO: Give transaction ID, timestamp.
    dbTxn.putBinary(this._txnDb, makeTxnKey(txnv), msgpack.encode(txnOut))

    // This is the point of no return.
    dbTxn.commit()

    //console.log('committed', txn, txnOut, txnv)

    this.version = txnv // normally this.version + 1.
    this._notify(txn, txnv)

    // TODO: At least for now transactions are guaranteed to operate on one
    // source (to be atomic). So the versions object will always be a single
    // source / version pair. Although, for databases which don't support
    // multi-key transactions this won't hold. Is returning the version in this
    // format appropriate?
    process.nextTick(() => callback(null, {[this.source]: txnv}))
  }

  // Fetch for sorted key values. The query is a range op object.
  fetch(qtype, ranges, versions, opts = {}, callback) {
    assert(qtype === 'sortedkv')

    const qops = queryops[qtype]

    qops.checkOp(ranges)

    if (qops.isEmpty(ranges)) {
      // Early return because in this case we explicitly want to say the result doesn't depend on the version.
      return process.nextTick(() => callback(null, {results:new Map, queryRun:ranges, versions:{}}))
    }

    // Options are:
    // - limitDocs, limitBytes: Limit how much data we pull. 0 / undefined
    //   means no limit. We always pull whole documents, so limitBytes will be
    //   advisory. We will probably exceed it.
    // - noDocs: Don't include the documents themselves in the data. All docs
    //   are replaced with (true / 1) in the fetch results.

    // Not sure what to pass through in options, but I'll definitely need some
    // stuff. Its a placeholder for now.
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
    let minVersion = this.minVersion

    //console.log('fetchSKV', ranges, vrange)

    const dbTxn = this._env.beginTxn({readOnly:true})

    let err = null

    let bytesRead = 0, docsRead = 0

    const cursor = new lmdb.Cursor(dbTxn, this._snapDb)
    // This is sync, because we can make it sync.
    const queryRun = rangeutil.eachInRanges2(ranges, wrapLMDBCursor(cursor), [], (k, cell, qval) => {
      if (qval <= 0 || err) return

      bytesRead += cell.length
      const [lastMod, data] = msgpack.decode(cell)

      if (lastMod > vrange[1]) { // TODO: > or >=?
        // TODO: Alternately we could cache the old value in the txn / in memory to support this. ???
        err = Error('Version too old'); return
      }

      minVersion = max(minVersion, lastMod)
      if (data !== null) {
        results.set(k, opts.noDocs ? 1 : data)
        docsRead++
      }

      if (opts.limitBytes && bytesRead >= opts.limitBytes) return true
      else if (opts.limitDocs && docsRead >= opts.limitDocs) return true
      else return false
    })
    cursor.close()
    dbTxn.commit() // Its a readonly transaction - I assume commit and abort are the same

    process.nextTick(() =>
      err ? callback(err)
        : callback(null, {
          results,
          queryRun,
          versions:{[this.source]: [minVersion, this.version]},
        })
    )
  }

}

module.exports = (location, options) => new Store(location, options)

if (require.main === module) {
  const pollAll = (sub, callback) => {
    if (sub.isComplete()) return callback()
    else sub.next({}, err => {
      if (err) return callback(err)
      pollAll(sub, callback)
    })
  }

  const store = new Store('db')

  store._whenReady(() => {
    console.log('store source', store.source, 'at version', store.version)

    const txn = new Map([['a', {type:'set', data:1000}], ['c', {type:'set', data:'hi'}]])
    store.mutate(txn, {}, {}, (err) => {console.log(err)})

    const sub = store.subscribe('sortedkv', ['<a', 1, '>c'], {}, {limitDocs:1}, (type, txn, source, v) => {
      console.log(type, txn, source, v)
      console.log('data: ', sub.data)
    })
    pollAll(sub, err => {
      console.log('done polling', err, sub.data)
    })

    setInterval(() => {
      store.mutate(new Map([['a', {type:'inc', data:1}]]), {}, {}, (err, v) => {
        if (err) throw err
        console.log('operation accepted at', v)
      })
    }, 500)

    setTimeout(() => {
      console.log('modifying subscription')
      sub.modify(['<c', -1, '.', 0, '<z', 1, '.'])
      pollAll(sub, err => console.log(err, sub.data))
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

