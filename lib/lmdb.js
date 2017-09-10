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

const resultset = require('./resultset')
const rangeutil = require('./rangeutil')

const PriorityQueue = require('priorityqueuejs')


const min = (a, b) => a < b ? a : b
const max = (a, b) => a > b ? a : b

const newList = () => []

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
  return buffer.readUInt32BE(TXN_PREFIX.length + 4);
}

function makeTxnKey(v) {
  const buffer = Buffer.allocUnsafe(TXN_PREFIX.length + 8)
  TXN_PREFIX.copy(buffer)
  buffer.writeUInt32BE(v, TXN_PREFIX.length + 4);
  buffer.writeUInt32BE(0, TXN_PREFIX.length);
  return buffer;
}

const isTxnKey = (k) => k.length >= TXN_PREFIX.length && TXN_PREFIX.compare(k, 0, TXN_PREFIX.length) === 0
assert(isTxnKey(TXN_PREFIX))
assert(isTxnKey(TXN_MAX_KEY))
assert(!isTxnKey(CONFIG_KEY))
assert(!isTxnKey(Buffer.from('\x01tx')))

const asBuf = (x) => x == null ? null : Buffer.isBuffer(x) ? x : Buffer.from(x)

const doNothing = () => {}

const getDefault = (collection, k, fn) => {
  let v = collection.get(k)
  if (v == null) {
    v = fn(k)
    collection.set(k, v)
  }
  return v
}

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

const capabilities = {
  // What other things should I put here?

  // TODO: What should we call the standard txn type?
  mutationTypes: new Set(['kv']),
  opTypes: new Set(), // For document operations.
  queryTypes: new Set(['sortedkv']),

  // TODO: Not sure if these are the best names...
  getOpsStrategies: new Set(['forwards', 'backwards']),

  limitBy: new Set(['ops', 'docs', 'bytes']), // limitBy docs applies to getOps and fetch...
}


class Store {
  close() {
    this._snapDb.close()
    this._txnDb.close()
    this._env.close()
  }

  constructor(location = 'db', options = {}) {
    if (!location || typeof location === 'object') throw Error('Invalid location');

    this._env = new lmdb.Env()

    this.capabilities = capabilities

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
          this.version = decodeVersion(key)
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

    const subfns = subStore(this.capabilities, this.catchup.bind(this))
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
    const txnOut = [] // msgpack-lite can't encode Maps. I could set up a custom codec ... :/

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
      const result = resultset.applyOne(data, docop)
      //console.log('->', result)
      // If the result is null (which is to say, the document got deleted)
      // we still need to keep the placeholder around until the
      // corresponding version falls off the edge of recorded history.
      dbTxn.putBinary(this._snapDb, kbuf, msgpack.encode([txnv, result]))

      // Removed code to also store docop.newVal here. You never really want
      // that in a real system. The two benefits are:
      // - Allowing realtime streaming clients which don't understand the real
      // operations to retroactively get full history, but thats not worth the
      // performance or complexity cost.
      // - Allowing clients to request old copies of the data when they call
      // fetch(). This is useful for the router, but it can always getOps and
      // wait for ops.

      // We record the previous modified version for getOps. This effectively
      // forms a linked list of operations in the transaction log that we can
      // scan and collect when we're looking for history.
      //
      // I'm double-msgpack encoding the data itself, so I can filter it in
      // getOps without having to actually decode the data. This is pretty
      // efficient with msgpack - it just adds ~2 bytes of overhead. But it
      // would be cleaner if I had a streaming decoder.
      txnOut.push([k, docop.type, lastMod, msgpack.encode(docop.data)])
    }

    // Store them sorted, so we can scan more efficiently.
    txnOut.sort((a, b) => a[0] > b[0] ? 1 : -1)

    // TODO: Give transaction ID, timestamp.
    const meta = {ts:Date.now()}
    dbTxn.putBinary(this._txnDb, makeTxnKey(txnv), msgpack.encode([meta, txnOut]))

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
  //
  // Options are:
  // - limitDocs, limitBytes: Limit how much data we pull. 0 / undefined
  //   means no limit. We always pull whole documents, so limitBytes will be
  //   advisory. We will probably exceed it.
  // - noDocs: Don't include the documents themselves in the data. All docs
  //   are replaced with (true / 1) in the fetch results.
  //
  // - atVersions: source -> version pairs at which the client is requesting the document. NYI TODO
  // - noCache: Only get the latest copy of the documents. Do not return cached copy. NYI
  // - ifChangedSince: version. NYI
  fetch(qtype, ranges, opts = {}, callback) {
    assert(qtype === 'sortedkv')
    assert(typeof callback === 'function')

    const qops = queryops[qtype]

    qops.checkOp(ranges)

    if (qops.isEmpty(ranges)) {
      // Early return because in this case we explicitly want to say the result doesn't depend on the version.
      return process.nextTick(() => callback(null, {results:new Map, queryRun:ranges, versions:{}}))
    }

    // Not sure what to pass through in options, but I'll definitely need some
    // stuff. Its a placeholder for now.
    const reqV = (opts.atVersions && opts.atVersions[this.source]) || [0, Infinity]

    if (reqV[0] > this.version) {
      // TODO: Hold the query until the version catches up?
      return callback(Error('Requested version in the future'))
    }

    const results = new Map
    let minVersion = this.minVersion

    //console.log('fetchSKV', ranges, reqV)

    const dbTxn = this._env.beginTxn({readOnly:true})

    let err = null

    let bytesRead = 0, docsRead = 0

    const cursor = new lmdb.Cursor(dbTxn, this._snapDb)
    // This is sync, because we can make it sync.
    const queryRun = rangeutil.eachInRanges2(ranges, wrapLMDBCursor(cursor), [], (k, cell, qval) => {
      // Kinda weird - we return false to continue, true to stop. Cleaner to use an es6 iterator.

      if (qval <= 0 || err) return false

      bytesRead += cell.length
      const [lastMod, data] = msgpack.decode(cell)

      if (lastMod > reqV[1]) { // TODO: > or >=?
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

  // ****** Get Ops.

  _getTxn(cursor, v) {
    assert(v >= this.minVersion)
    assert(v <= this.version)
    assert(cursor.goToKey(makeTxnKey(v)) !== null) // I hate goToKey.

    let data = null
    cursor.getCurrentBinary((key, txn) => {
      assert(decodeVersion(key) === v)
      data = msgpack.decode(txn)
    })

    return data
  }

  _getOpsScan(query, from, to, opts) {
    const dbTxn = this._env.beginTxn({readOnly:true})
    const cursor = new lmdb.Cursor(dbTxn, this._txnDb)

    // Get the operations. The returned range is (from, to].
    let v = from + 1

    const results = []
    while (v <= to) {
      // Alternately I could just use cursor.goToNext() and check the key
      // matches, but this logic is simpler.
      //
      // If there's any ops missing right now I'm going to assert. Might want
      // to consider being accomodating if data is missing at some point, but
      // not right now.

      const [meta, txnEntries] = this._getTxn(cursor, v)

      let txn = null
      // These are stored sorted, so we can walk them with the query.
      const txnCursor = rangeutil.arrayCursor(txnEntries, x => x[0])
      rangeutil.eachInRanges(query, txnCursor, (k, [_, type, lastMod, data]) => {
        if (txn == null) txn = new Map

        // Note that I'm ignoring supportedTypes here. Client has to make do.
        // I have no idea if this is the right call.
        txn.set(k, {type, data: msgpack.decode(data)})
      })
      if (txn != null) results.push({source:this.source, v, meta, txn})

      v++

      if (opts.limitOps && results.length >= opts.limitOps) break
    }

    cursor.close()
    dbTxn.commit()

    return {ops: results, versions:{[this.source]: [from, v-1]}}
  }

  // Versions are {[source]: [from, to]} pairs where the data returned is in
  // the range of (from, to]. You can think of the results as the operations
  // moving from document version from to document version to.
  //
  // to:-1 will get all available operations.
  //
  // TODO: Options for fetching document if it makes sense. Policy could be:
  // - Always send all ops
  // - Send ops only if that'll be smaller
  // - [Never send ops - just send the resultant documents - which is fetch
  //   with ifChangedSince.]
  // And, should you be able to override that per-document?
  //
  //
  // Options:
  // - bestEffort: if we can't get all the requested operations, don't abort
  //   but return what we can.
  // - limitBytes: Limit on the amount of data to read & return. Advisory
  //   only. Will always try to make progress (that is, return at least one
  //   operation). There is no limitDocs equivalent because you can just
  //   shrink the requested range if thats what you're after. NYI
  // - limitOps: Limit the number of operations returned. NYI
  getOps(qtype, query, versions, opts, callback) {
    assert(qtype === 'sortedkv')
    assert(typeof callback === 'function')

    const asyncCb = (err, results) => process.nextTick(() => callback(err, results))

    // This is inclusive at the top, but not at the bottom of the range.
    // ie, (v1, v2]. You can think of the requested version range as a range of
    // document versions, and the returned operations specify how the documents
    // in the query changed from v1 to v2.
    const vs = versions[this.source]
    // TODO: Should I return out the actual db versions?
    if (vs == null || vs[0] === vs[1]) return asyncCb(null, {ops:[], versions:{}})

    let [from, to] = vs

    if (from < this.minVersion) { // TODO: is this comparison right?
      if (opts.bestEffort) from = this.minVersion
      else return asyncCb(Error('Requested range too old'))
    }

    // TODO: not sure what this should actually do. Maybe in bestEffort we should just trim the range?
    if (to > this.version) return asyncCb(Error('Requested to version is in the future'))

    if (to === -1) to = this.version

    const data = this._getOpsScan(query, from, to, opts)

    asyncCb(null, data)
  }



  // Functionally similar to getOps, but with some important differences.
  // Returns all operations -> current, unless the document itself is smaller
  // than the ops we need to send - in which case we send a skip-to-current
  // operation instead.
  //
  // I'm not sure if I should expose this publically. Its sort of an
  // optimization on top of getOps, and I'll probably need to tweak its
  // behaviour a bit in ways that I'm not sure I want for a public API.
  //
  //
  // versions is scalar specifying lastest version at which the client has
  // document snapshots for the specified query. (eg {"source":3})
  //
  // TODO: Add a way to be more granular with our per-document version policy.
  //
  // Options:
  // - mode: 'fast' or 'full'. Full returns all operations in the specified
  //   range. fast returns whatever will take less space on the wire.
  // - limitDocs: limit the returned history to the specified number of documents
  // - NYI limitBytes, limitOps.
  // - fullOverride: set of documents for which we really do want the full set
  //   of ops. This is important when the client has a write pending.
  // - supportedTypes: OT types supported by client. If history uses an
  //   unsupported type, we skip history & send a full document snapshot.
  // - bestEffort: Return any ops we have instead of erroring
  //
  // This function also returns the data in a slightly different format - its
  // document first, instead of operation-first. Its just easier to construct
  // that way.
  catchup(qtype, query, versions, opts, callback) {
    assert(qtype === 'sortedkv')
    assert(typeof callback === 'function')

    const asyncCb = (err, results) => process.nextTick(() => callback(err, results))

    const supportedTypes = resultset.fromUserSupportedTypes(opts.supportedTypes)

    // from could be older than the operations we store. Thats ok - we'll just
    // fallback to giving the client a fresh snapshot.
    let from = versions[this.source]

    // First we run the query against the current working set to get last
    // modified versions and current snapshots.

    const queue = new PriorityQueue() // using default comparator of max()
    const dbTxn = this._env.beginTxn({readOnly:true})

    const docData = new Map // doc name -> current data. TODO: Better to keep this msgpack-encoded.
    const docSize = new Map // doc name -> remaining willingness to send operations instead of a snapshot, in bytes.

    const relevantOpsInTxn = new Map // from version number -> set of docs to fetch.
    const addRelevant = (v, k) => {
      getDefault(relevantOpsInTxn, v, (v) => {
        queue.enq(v)
        return new Set
      }).add(k)
    }

    const snapCursor = new lmdb.Cursor(dbTxn, this._snapDb)
    const queryRun = opts.limitDocs ? [] : null

    const results = new Map // doc -> list of operations.

    const mode = opts.mode || 'fast'
    assert(mode === 'fast' || mode === 'full')

    let docsRead = 0
    // I could do limitBytes here and count bytes in the snapshots, but its
    // possible that the ops will be *way* smaller than the documents and if we
    // apply limitBytes here we could be too restrictive.

    let err = null

    let minVersion = this.minVersion // The smallest version we actually saw.

    rangeutil.eachInRanges2(query, wrapLMDBCursor(snapCursor), queryRun, (k, cell, qval) => {
      if (qval <= 0) return false

      // TODO: We're decoding the entire document unnecessarily in many cases.
      // Either use a streamable decoder or write a little packed binary
      // representation here.
      const [v, data] = msgpack.decode(cell)

      minVersion = max(minVersion, v)

      if (v <= from) return false // Client is up to date. Skip!
      else if (data == null && mode === 'fast') {
        // Document was deleted. Who cares about the ops?
        // TODO: In fast mode we should probably also do this for small documents (<10 bytes or so)
        results.set(k, [{v, type:'rm'}])
      } else if (v < this.minVersion) { // TODO: Or <= ?
        // The document was modified more recently than the history we store. Client needs a fresh snapshot.
        if (mode === 'full' && !opts.bestEffort) {
          err = Error('Requested version too old')
          return true
        }

        // TODO: And update bytesRead when I support that.
        results.set(k, [data === null ? {v:v, type:'rm'} : {v:v, type:'set', data}])
      } else {
        // Normal case. Mark the document and we'll scan its history.
        docSize.set(k, cell.length) // Not entirely accurate, but it doesn't matter too much.
        docData.set(k, data)

        addRelevant(v, k)
      }

      docsRead++

      // Return true if we've hit our document limit.
      return opts.limitDocs && docsRead >= opts.limitDocs
    })
    snapCursor.close()

    if (err) return asyncCb(null, err)


    // Ok, now we scan for actual operations.

    const txnCursor = new lmdb.Cursor(dbTxn, this._txnDb)
    while (!queue.isEmpty()) {
      const v = queue.deq()
      assert(v > from)
      const docs = relevantOpsInTxn.get(v)

      const [meta, entries] = this._getTxn(txnCursor, v)
      let found = 0

      // entries is a list. TODO: Avoid scanning entire txns if we can help it.
      for (let i = 0; i < entries.length && found < docs.size; i++) {
        // The entry is [k, type, lastMod, opdata].
        if (!docs.has(entries[i][0])) continue
        found++

        const [key, type, lastMod, encdata] = entries[i]

        if (mode === 'fast') {
          const opsize = encdata.length + 1 // 1 byte of overhead from msgpack.
          const patience = docSize.get(key) - opsize
          if (patience <= 0) {
            // Its easier to simply send the client a fresh snapshot.
            results.set(key, [{v, type:'set', data:docData.get(key)}])
            continue
          } else {
            docSize.set(key, patience)
          }
        } else if (!supportedTypes.has(type)) {
          // Not sure exactly what the bestEffort behaviour should be here.
          if (mode === 'full' && !opts.bestEffort) {
            return asyncCb(null, Error('Cannot send whole history - client does not support operations'))
          }

          results.set(key, [{v, type:'set', data:docData.get(key)}]) // TODO: DRY rotate this
          continue
        }

        getDefault(results, key, newList).unshift({v, type, data:msgpack.decode(encdata)})
        if (lastMod > from) addRelevant(lastMod, key)
      }
    }
    txnCursor.close()

    dbTxn.commit()

    return {
      results,
      queryRun,
      versions: {[this.source]: [minVersion, this.version]}
    }
  }
  // TODO: Add a check function.

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
