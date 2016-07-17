const debug = require('debug')('statecraft');

function doNothing() {}

function asyncEach(collection, fn, callback) {
  var work = collection.size;
  if (work === 0) return callback();

  var hasErrored = false;

  collection.forEach((v, k) => {
    fn(v, k, (err) => {
      if (hasErrored) return; // Only callback once.
      if (err) {
        hasErrored = true;
        return callback(err);
      }

      if (--work === 0) {
        callback();
      }
    });
  });
}

function writeConflict(key) {
  const err = new Error('Conflict during write');
  err.conflict = true;
  return err;
}

const TYPES = {
  BLOB: 0,
  JSON: 1
};

function decodeVersion(buffer) {
  // There is no readuint64. (Well actually we need readuint56)
  // I don't expect this prototype to last long enough to see 4 billion
  // operations anyway, so who's counting...
  return buffer.readUInt32LE();
}

function encodeVersion(v) {
  const buffer = Buffer.allocUnsafe(8).fill(0);
  buffer.writeUInt32LE(v);
  return buffer;
}

function decodeRecord(buffer) {
  // The format is:
  // 7 bytes - LE version
  // 1 byte  - type (see type table above)
  // rest    - actual data

  const v = decodeVersion(buffer);
  const type = buffer.readUInt8(7);
  const dataPart = buffer.slice(8);

  var data;
  switch (type) {
    case TYPES.BLOB: data = dataPart; break;
    case TYPES.JSON: data = JSON.parse(dataPart.toString('utf8')); break;
    default: throw Error('Invalid type in value');
  }

  // We don't return the type - the user can typeof(data) themselves.
  return {v, data};
}

function encodeRecord(v, data) {
  var dataSize;
  var jsonstr;

  if (Buffer.isBuffer(data)) {
    dataSize = data.length;
  } else {
    jsonstr = JSON.stringify(data);
    dataSize = Buffer.byteLength(jsonstr);
  }

  const buffer = Buffer.allocUnsafe(dataSize + 8).fill(0, 0, 8);
  buffer.writeUInt32LE(v, 0);

  if (Buffer.isBuffer(data)) {
    buffer.writeInt8(TYPES.BLOB, 7);
    data.copy(buffer, 8);
  } else {
    buffer.writeInt8(TYPES.JSON, 7);
    buffer.write(jsonstr, 8);
  }

  return buffer;
}

// Version is a single monotonically increasing number
//
//
// The model here is a database with one monotonically increasing version
// number. The version increases with each commit, which themselves contain a
// set of {doc, change} modifications.
//
// Each document has a _v property which is the version at which that document
// was last modified. Transactions list which versions each conflicting
// document is known at (ie, the version at which the document was fetched, or
// if the document is subscribed then the most recent known version). The
// transaction fails if any named document has a version more recent than the
// version at which it is known. (I'll insert optional OT into that process at
// some point.)
// 
class Store {
  constructor(location, options = {}) {
    const db = require('levelup')(location, {
      valueEncoding: 'binary',
      db: options.db || require('leveldown')
    });

    this.lock = require('lock')();

    this.ready = new Promise((res, rej) => {
      db.get('__v', (err, record) => {
        if (err && err.notFound) {
          debug('Initializing a new database at version 0');
          this.version = 0;
          db.put('__v', encodeVersion(this.version), (err) => {
            if (err) return rej(err);
            res(db);
          });
        } else if (err) {
          rej(err);
        } else {
          // The version is a LE i64.
          this.version = decodeVersion(record);
          debug('Initialized existing database at version', this.version);
          res(db);
        }
      });
    });
  }

  _whenReady(fn) {
    this.ready.then(db => fn(null, db), err => fn(err));
  }

  applyTxn(txn, callback) {
    // A transaction has:
    // - edits: A set of (document, conflict version, optional operations) triples.
    // (might support ranges later).
    // - ??? Access token, ..? Or do we check that externally?
    this._whenReady((err, db) => err ? callback(err) : this.lock('write', release => {
      // Concurrent with reads, so we won't bump the version until we're ready
      // to release the write lock.
      const {edits} = txn;

      const batch = db.batch();

      const resultingVersion = this.version + 1;

      // edits is a map of doc -> {v, op}.
      asyncEach(edits, ({v:expectedV, op}, key, callback) => {
        db.get(key, (err, record) => {
          if (err) {
            if (!err.notFound) return callback(err);

            if (expectedV != null && expectedV !== -1) return callback(writeConflict(key));
          } else {
            const v = decodeVersion(record);

            if (expectedV != null && v > expectedV) return callback(writeConflict(key));
          }

          if (op !== undefined) {
            // For now, the dumbest possible operations.
            switch(op.action) {
              case 'del': batch.del(key); break;
              case 'set': batch.put(key, encodeRecord(resultingVersion, op.data)); break;
              default: return callback(Error(`Invalid operation type: ${op.action}`)); 
              // Delete.
            }
          }
          
          callback();
        });
      }, (err) => {
        if (err) {
          release();
          return callback(err);
        }

        batch
          .put('__v', encodeVersion(resultingVersion))
          .write(err => {
            if (!err) this.version = resultingVersion;
            release();
            callback(err);
          });
      });
    }));
  }

  get(key, callback) {
    // Don't need to serialize reads.
    return this._whenReady((err, db) => {
      if (err) return callback(err);
      db.get(key, (err, record) => {
        if (err) return callback(err);

        const data = decodeRecord(record);
        // We know the document hasn't been changed since the current database
        // version. Ignore the document version.
        callback(null, data.data, this.version);
      });
    });
  }

  // Simple set value at path. expectedV and callback are both optional.
  set(path, value, expectedV, callback) {
    if (typeof expectedV === 'function') {
      callback = expectedV;
      expectedV = null;
    }

    const edits = new Map;
    edits.set(path, {op: {action:'set', data:value}, v:expectedV});
    this.applyTxn({edits}, callback || doNothing);
  }

}




module.exports = (...args) => new Store(...args)

if (require.main === module) {
  const store = new Store('db', {db: require('memdown')});
  store.set('/foo/bar', {x:5}, (err) => {
    if (err) console.error(err);

    store.get('/foo/bar', (err, data, v) => {
      console.log('got data', data, 'at version', v, 'type', typeof(data));
    });
  });

}

