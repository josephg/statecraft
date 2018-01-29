// This file implements an lmdb kv store on top of prozess.
//
// For now it bootstraps by replaying the event log.

import assert = require('assert')
import lmdb = require('node-lmdb')
import fs = require('fs')
import msgpack = require('msgpack-lite')
import debugLib = require('debug')

// Its very sad that this has a direct dependancy on prozess client.
// It'd be way better to abstract this out, but its too early for that.
import {PClient} from 'prozess-client'
import {encodeTxn, decodeTxn, decodeEvent, sendTxn} from '../prozess'

import fieldOps from '../types/fieldops'
import {queryTypes} from '../types/queryops'

import * as I from '../types/interfaces'
import err from '../err'

const debug = debugLib('statecraft')
const CONFIG_KEY = Buffer.from('\x01config')
const VERSION_KEY = Buffer.from('\x01v')
const encodeVersion = (v: I.Version) => {
  const buf = Buffer.allocUnsafe(8)
  buf.writeUInt32LE(0, 0)
  buf.writeUInt32LE(v, 4)
  return buf
}
const decodeVersion = (buf: NodeBuffer) => buf.readUInt32LE(4)

// We take ownership of the PClient, so don't use it elsewhere after passing it to lmdbstore.
const lmdbStore = (client: PClient, location: string, onCatchup?: I.Callback<I.Version>): I.SimpleStore => {
  const env = new lmdb.Env()

  assert(client.source, 'Cannot attach lmdb store until source is known')
  const source: I.Source = client.source!

  // Check that the directory exists.
  try { fs.mkdirSync(location) }
  catch(e) { if (e.code !== 'EEXIST') throw e }

  env.open({path: location, maxDbs: 2, noTls: true})

  const dbi = env.openDbi({name: null, create: true})
  // const configdb = env.openDbi({name: 'config', create: true})

  // Note: I'm using 'native' Prozess version numbers, so the local store
  // starts at version 0 and event 1 moves us to version 1.
  let version: I.Version = 0

  const setVersion = (txn: lmdb.Txn, v: I.Version) => {
    version = v
    txn.putBinary(dbi, VERSION_KEY, encodeVersion(version))
  }

  const rawGet = (txn: lmdb.Txn, k: I.Key): [I.Version, any] => {
    const bytes = txn.getBinary(dbi, k)
    return bytes == null ? [0, null] : msgpack.decode(bytes)
  }

  // Ok, first do catchup.
  {
    const txn = env.beginTxn()
    const configBytes = txn.getBinary(dbi, CONFIG_KEY)
    if (configBytes == null) {
      console.log('Database was created - no config!')
      version = 0
      txn.putBinary(dbi, CONFIG_KEY, msgpack.encode({sc_ver: 1, source}))
      setVersion(txn, version)
    } else {
      const {sc_ver, source:dbSource} = msgpack.decode(configBytes)
      assert(sc_ver === 1)
      assert(dbSource === source)
      version = decodeVersion(txn.getBinary(dbi, VERSION_KEY))
    }
    txn.commit()
  }
  debug('Opened database at version', version)

  // TODO: Generate these based on the opstore.
  const capabilities = {
    queryTypes: new Set<I.QueryType>(['allkv', 'kv']),
    mutationTypes: new Set<I.ResultType>(['resultmap']),
  }

  const ready = new Promise((resolve, reject) => {
    client.subscribe(version + 1, {}, (err, results) => {
      if (err) {
        // Again, not sure what to do here. Eat it and continue.
        console.error('Error subscribing', err)
        return reject(err)
      }

      // The events will all be emitted via the onevent callback. We'll do catchup there.
      console.log(`Catchup complete - ate ${results!.v_end - results!.v_start} events`)
      resolve()
    })
  })

  if (onCatchup) {
    ready.then(() => onCatchup(null, version))
    ready.catch(err => onCatchup(err))
  }

  const store: I.SimpleStore = {
    sources: [source],
    capabilities: capabilities,

    fetch(qtype, query, opts, callback) {
      // TODO: Allow range queries too.
      if (/*qtype !== 'allkv' &&*/ qtype !== 'kv') return callback(new err.UnsupportedTypeError())
      const qops = queryTypes[qtype]

      ready.then(() => {
        const dbTxn = env.beginTxn({readOnly: true})

        // KV txn. Query is a set of keys.
        let maxVersion = 0

        const results = new Map<I.Key, I.Val>()
        for (let k of query) {
          const [lastMod, doc] = rawGet(dbTxn, k)
          results.set(k, doc)
          maxVersion = Math.max(maxVersion, lastMod)
        }

        dbTxn.commit()

        callback(null, {
          results,
          queryRun: query,
          // TODO: Loosen this version bound.
          versions: {[source]: {from: maxVersion, to: version}}
        })
      }).catch(e => process.emit('uncaughtException', e))
    },

    mutate(type, _txn, versions, opts, callback) {
      if (type !== 'resultmap') return callback(new err.UnsupportedTypeError())
      const txn = _txn as I.KVTxn

      ready.then(() => {
        debug('mutate', txn)

        // What does -1 mean? What does 0 mean? Urgh.
        const conflictVersion = versions[source] !== 0 ? versions[source] : version

        // First check that the transaction applies cleanly.
        const dbTxn = env.beginTxn({readOnly: true})
        for (const [k, op] of txn) {
          const [v, data] = rawGet(dbTxn, k)
          if (conflictVersion >= 0 && v > conflictVersion) {
            dbTxn.abort()
            return callback(new err.WriteConflictError('Write conflict in key ' + k))
          }

          try {
            fieldOps.checkOp!(op, data)
          } catch (e) {
            dbTxn.abort()
            return callback(e)
          }
        }
        dbTxn.commit()

        sendTxn(client, txn, conflictVersion, {}, (err, version) => {
          if (err) callback(err)
          else callback(null, {[source]: version!})
          debug('mutate cb', err, version)
        })
      }).catch(e => process.emit('uncaughtException', e))
    },

    getOps(qtype, query, versions, opts, callback) {
      // We don't need to wait for ready here because the query is passed straight back.

      // TODO: Allow range queries too.
      if (qtype !== 'allkv' && qtype !== 'kv') return callback(new err.UnsupportedTypeError())
      const qops = queryTypes[qtype]

      // We need to fetch ops in the range of (from, to].
      const vs = versions[source] || versions._other
      if (!vs) return callback(null, {ops: [], versions: {}})

      const {from, to} = vs

      client.getEvents(from + 1, to, {}, (err, data) => {
        if (err) return callback(err)

        // Filter events by query.
        const ops = data!.events.map(event => decodeEvent(event, source))
        ops.forEach((data) => data.txn = qops.filterTxn(data.txn, query))

        callback(null, {
          ops,
          versions: {[source]: {from:data!.v_start - 1, to: data!.v_end - 1}}
        })
      })
    },

    close() {
      dbi.close()
      env.close()

      // We take ownership, so this makes sense.
      client.close()
      // And close the lmdb database.
    },
  }


  client.onevents = (events, nextVersion) => {
    // debug('Got events', events, nextVersion)

    const dbTxn = env.beginTxn()

    let newVersion = version

    const txnsOut: {txn: I.KVTxn, from: I.Version, to: I.Version}[] = []

    events.forEach(event => {
      // This is kind of a big assertion.
      assert(newVersion === event.version - 1, 'Error: Version consistency violation. This needs debugging')

      // TODO: Batches.
      const txn = decodeTxn(event.data)
      const nextVersion = event.version + event.batch_size - 1

      for (const [k, op] of txn) {
        const oldData = rawGet(dbTxn, k)[0]

        const newData = fieldOps.apply(oldData, op)
        console.log('updated key', k, 'from', oldData, 'to', newData)

        // I'm leaving an empty entry in the lmdb database even if newData is
        // null so fetch will correctly report last modified versions.
        // This can be stripped with a periodically updating baseVersion if
        // thats useful.
        dbTxn.putBinary(dbi, k, msgpack.encode([nextVersion, newData]))
      }

      txnsOut.push({txn, from: version, to: nextVersion})
      newVersion = nextVersion
    })

    console.log('new version', newVersion)
    setVersion(dbTxn, newVersion)
    dbTxn.commit()

    if (store.onTxn) txnsOut.forEach(({txn, from, to}) =>
      store.onTxn!(source, from, to, 'resultmap', txn)
    )
  }

  return store
}

export default lmdbStore
