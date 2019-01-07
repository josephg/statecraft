// This file implements an lmdb kv store on top of prozess.
//
// For now it bootstraps by replaying the event log.

import assert from 'assert'
import lmdb from 'node-lmdb'
import fs from 'fs'
import msgpack from 'msgpack-lite'
import debugLib from 'debug'

// Its very sad that this has a direct dependancy on prozess client. It'd be
// way better to abstract this out into some generic op stream interface.
import {PClient} from 'prozess-client'
import {encodeTxn, decodeTxn, decodeEvent, sendTxn} from '../prozess'

import fieldOps from '../types/field'
import {queryTypes} from '../qrtypes'
import sel from '../sel'

import * as I from '../interfaces'
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
const decodeVersion = (buf: Buffer) => buf.readUInt32LE(4)

// Valid keys are in the [0x02, 0xff) range.
const START_KEY = '\x02'
const END_KEY = '\xff'

const START_SEL = sel(START_KEY, false)
const END_SEL = sel(END_KEY, false)

// We take ownership of the PClient, so don't use it elsewhere after passing it to lmdbstore.
//
// ... At some point it'll make sense for the caller to get more detailed notifications about catchup state.
// For now the promise won't be called until catchup is complete.
const lmdbStore = (client: PClient, location: string): Promise<I.SimpleStore> => {
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

  // Ok, first do catchup.
  {
    const txn = env.beginTxn()
    const configBytes = txn.getBinary(dbi, CONFIG_KEY)
    if (configBytes == null) {
      console.log('Database was created - no config!')
      txn.putBinary(dbi, CONFIG_KEY, msgpack.encode({sc_ver: 1, source}))
      setVersion(txn, 0)
    } else {
      const {sc_ver, source:dbSource} = msgpack.decode(configBytes)
      assert(sc_ver === 1, 'LDMB database was set up using invalid or old statecraft version.')
      assert(dbSource === source, `LDMB database at ${location} is invalid. Delete and restart`)
      version = decodeVersion(txn.getBinary(dbi, VERSION_KEY))
    }
    txn.commit()
  }
  debug('Opened database at version', version)

  // TODO: Generate these based on the opstore.
  const capabilities = {
    queryTypes: new Set<I.QueryType>(['allkv', 'kv', 'static range', 'range']),
    mutationTypes: new Set<I.ResultType>(['kv']),
  }

  const ready = new Promise((resolve, reject) => {
    client.subscribe(version + 1, {}, (err, results) => {
      // console.log('catchup', results)
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


  const decode = (bytes: Buffer | null): [I.Version, any] => bytes == null ? [0, null] : msgpack.decode(bytes)
  const rawGet = (txn: lmdb.Txn, k: I.Key) => decode(txn.getBinaryUnsafe(dbi, k))

  // TODO: Probably cleaner to write this as iterators? This is simpler / more
  // understandable though.
  const getKVResults = (dbTxn: lmdb.Txn, query: Iterable<I.Key>, opts: I.FetchOpts, resultsOut: Map<I.Key, I.Val>) => {
    let maxVersion = 0

    for (let k of query) {
      const [lastMod, doc] = rawGet(dbTxn, k)
      if (doc != null) resultsOut.set(k, opts.noDocs ? 1 : doc)
      // Note we update maxVersion even if the document is null.
      maxVersion = Math.max(maxVersion, lastMod)
    }

    return maxVersion
  }

  const getAllResults = (dbTxn: lmdb.Txn, opts: I.FetchOpts, resultsOut: Map<I.Key, I.Val>) => {
    let maxVersion = 0
    const cursor = new lmdb.Cursor(dbTxn, dbi)
    let k = cursor.goToRange('\x02') // positioned right after config key
    while (k != null) {
      const bytes = cursor.getCurrentBinaryUnsafe()
      const [lastMod, doc] = msgpack.decode(bytes)
      if (doc != null) resultsOut.set(k as string, opts.noDocs ? 1 : doc)
      maxVersion = Math.max(maxVersion, lastMod)

      k = cursor.goToNext()
    }
    cursor.close()

    return maxVersion
  }

  // const max = <T>(a: T, b: T) => a < b ? b : a

  // const cursorAt = (dbTxn: lmdb.Txn, sel: I.StaticKeySelector | I.KeySelector): [lmdb.Cursor, string | null] => {
    // const cursor = new lmdb.Cursor(dbTxn, dbi)
  //   const k = max(sel.k, '\02')
  //   let key = cursor.goToRange(k) as null | string
  //   if (key == k && sel.isAfter) key = cursor.goToNext() as null | string
  //   return [cursor, key]
  // }

  const setCursor = (cursor: lmdb.Cursor, sel: I.StaticKeySelector) => {
    let {k, isAfter} = sel
    let ck = cursor.goToRange(k < START_KEY ? START_KEY : k) as null | string
    if (ck === k && isAfter) ck = cursor.goToNext() as null | string
    return ck === null || ck >= END_KEY ? null : ck
  }

  const moveCursor = (cursor: lmdb.Cursor, offset: number): string | null => {
    while (true) {
      const key = (offset > 0 ? cursor.goToNext() : cursor.goToPrev()) as null | string
      // if (key == null) return offset > 0 ? END_KEY : START_KEY
      if (key == null || key < START_KEY || key >= END_KEY) return null
      offset += offset > 0 ? -1 : 1

      if (offset == 0) return key
    }
  }

  const bakeSel = (cursor: lmdb.Cursor, sel: I.KeySelector): I.StaticKeySelector => {
    // This is a bit ugly, and I'm sure there's a nicer way to write this.

    // This function could instead be written to just return a key.
    let {k, isAfter, offset} = sel

    if (k < START_KEY) { k = START_KEY; isAfter = false }
    else if (k >= END_KEY) { k = END_KEY; isAfter = false }

    let ck = setCursor(cursor, sel)
    // let ck = cursor.goToRange(k) as null | string
    // if (ck == k && isAfter) ck = cursor.goToNext() as null | string

    // There's no key at or after the specified point.
    if (ck == null) {
      if (offset >= 0) return {k, isAfter} // Also valid: END_SEL.
      else {
        // offset is negative, so we're counting back from the end of the database.
        ck = cursor.goToLast() as null | string
        if (ck == null || ck < START_KEY) return START_SEL // Db is empty.
        offset++
      }
    }

    if (offset && (ck = moveCursor(cursor, offset)) == null) {
      return offset > 0 ? END_SEL : START_SEL
    } else return {k: ck, isAfter: false}
  }

  const bakeRange = (dbTxn: lmdb.Txn, {low, high, limit, reverse}: I.Range): I.StaticRange => {
    const cursor = new lmdb.Cursor(dbTxn, dbi)

    let lowBake = bakeSel(cursor, low)
    let highBake = bakeSel(cursor, high)

    if (limit != null) {
      const fromBake = reverse ? highBake : lowBake
      const toBake = reverse ? lowBake : highBake

      if (sel.gtSel(toBake, fromBake)) {
        setCursor(cursor, fromBake)
        const limitEnd = moveCursor(cursor, reverse ? -limit : limit)

        if (limitEnd != null && (reverse ? limitEnd < toBake.k : limitEnd > toBake.k)) {
          toBake.k = limitEnd
          toBake.isAfter = false // ?? I think this is right...
        }

        if (reverse) { lowBake = toBake }
        else { highBake = toBake }
      }
    }

    return {low: lowBake, high: highBake, reverse}
    
    cursor.close()
  }

  function *rangeContentIter(dbTxn: lmdb.Txn, {low, high, reverse}: I.StaticRange) {
    const cursor = new lmdb.Cursor(dbTxn, dbi)
    
    const from = reverse ? high : low
    const to = reverse ? low : high

    let key = setCursor(cursor, from)

    while (key != null
        && (reverse ? sel.kGt(key, to) : sel.kLt(key, to))) {
      // This is awkward. Probably better to just break if we drop outside the range.
      if (key >= START_KEY && key < END_KEY) yield [key, cursor.getCurrentBinaryUnsafe()] as [string, Buffer]
      key = cursor.goToNext() as null | string
    }

    cursor.close()
  }

  const store: I.SimpleStore = {
    storeInfo: {
      sources: [source],
      capabilities,
    },

    async mutate(type, _txn, versions, opts = {}) {
      if (type !== 'kv') throw new err.UnsupportedTypeError()
      const txn = _txn as I.KVTxn

      await ready

      debug('mutate', txn)

      const expectedVersion = (versions && versions[source] != null) ? versions[source] : version

      // First check that the transaction applies cleanly.
      const dbTxn = env.beginTxn({readOnly: true})
      for (const [k, op] of txn) {
        const [v, data] = rawGet(dbTxn, k)
        if (expectedVersion !== -1 && v > expectedVersion) {
          dbTxn.abort()
          return Promise.reject(new err.WriteConflictError('Write conflict in key ' + k))
        }

        try {
          if (fieldOps.checkOp) {
            fieldOps.checkOp(op, fieldOps.create(data))
          }
        } catch (e) {
          dbTxn.abort()
          return Promise.reject(e)
        }
      }
      dbTxn.abort()

      // console.log('sendTxn', txn, expectedVersion)
      const resultVersion = await sendTxn(client, txn, opts.meta || {}, version, {})

      debug('mutate cb', resultVersion)
      return {[source]: resultVersion}
    },

    fetch(query, opts = {}) {
      // TODO: Allow range queries too.
      // if (!capabilities.queryTypes.has(query.type)) return Promise.reject(new err.UnsupportedTypeError(`${query.type} not supported by lmdb store`))
      const qops = queryTypes[query.type]
      let bakedQuery: I.Query | undefined

      return ready.then(() => {
        const dbTxn = env.beginTxn({readOnly: true})

        let results: I.ResultData
        // KV txn. Query is a set of keys.
        let maxVersion: number

        switch (query.type) {
          case 'kv':
            results = new Map<I.Key, I.Val>()
            maxVersion = getKVResults(dbTxn, query.q, opts, results)
            break
          case 'allkv':
            results = new Map<I.Key, I.Val>()
            maxVersion = getAllResults(dbTxn, opts, results)
            break

          case 'range':
            bakedQuery = {type: 'static range', q: query.q.slice()}
          case 'static range': {
            const q = query.q as I.RangeQuery // | I.StaticRangeQuery
            maxVersion = 0
            results = q.map((range) => {
              const staticRange = (query.type === 'range') ? bakeRange(dbTxn, range) : (range as I.StaticRange)
              const docs = [] // A map might be nicer.
              for (const [k, bytes] of rangeContentIter(dbTxn, staticRange)) {
                const [lastMod, doc] = decode(bytes)
                maxVersion = Math.max(maxVersion, lastMod)
                docs.push([k, doc])
              }
              return docs
            })

            break
          }
          default: throw new err.UnsupportedTypeError(`${query.type} not supported by lmdb store`)
        }
         // = query.type === 'kv'
         //  ? getKVResults(dbTxn, query.q, opts, results)
         //  : getAllResults(dbTxn, opts, results)

        dbTxn.commit()

        return {
          bakedQuery,
          results,
          versions: {[source]: {from: maxVersion, to: version}}
        }
      })
    },

    async getOps(query, versions, opts) {
      // We don't need to wait for ready here because the query is passed straight back.
      if (query.type !== 'allkv' && query.type !== 'kv' && query.type !== 'static range') throw new err.UnsupportedTypeError()
      const qops = queryTypes[query.type]

      // We need to fetch ops in the range of (from, to].
      const vs = versions[source] || versions._other
      if (!vs || vs.from === vs.to) return {ops: [], versions: {}}

      const {from, to} = vs

      const data = await client.getEvents(from + 1, to, {})
      // console.log('client.getEvents', from+1, to, data)

      // Filter events by query.
      let ops = data!.events.map(event => decodeEvent(event, source))
      .filter((data) => {
        const txn = qops.adaptTxn(data.txn, query.q)
        if (txn == null) return false
        else {
          data.txn = txn
          return true
        }
      })

      return {
        ops,
        versions: {[source]: {from:data!.v_start - 1, to: data!.v_end - 1}}
      }
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

    const txnsOut: {
      txn: I.KVTxn,
      from: I.Version,
      to: I.Version,
      view: Map<I.Key, I.Val>,
      meta: I.Metadata,
    }[] = []

    events.forEach(event => {
      // This is kind of a big assertion.
      assert(newVersion === event.version - 1,
        'Error: Version consistency violation. This needs debugging'
      )

      const view = new Map<I.Key, I.Val>()

      // TODO: Batches.
      const [txn, meta] = decodeTxn(event.data)
      // console.log('decodeTxn', txn, meta)
      const nextVersion = event.version + event.batch_size - 1

      for (const [k, op] of txn) {
        // const oldData = fieldOps.create(rawGet(dbTxn, k)[0], op)
        const oldData = rawGet(dbTxn, k)[1]

        const newData = fieldOps.apply(oldData, op)
        // console.log('updated key', k, 'from', oldData, 'to', newData)

        // I'm leaving an empty entry in the lmdb database even if newData is
        // null so fetch will correctly report last modified versions.
        // This can be stripped with a periodically updating baseVersion if
        // thats useful.
        dbTxn.putBinary(dbi, k, msgpack.encode([nextVersion, newData]))

        view.set(k, newData)
      }

      txnsOut.push({txn, from: version, to: nextVersion, view, meta})
      newVersion = nextVersion
    })

    // console.log('new version', newVersion)
    setVersion(dbTxn, newVersion)
    dbTxn.commit()

    if (store.onTxn) txnsOut.forEach(({txn, from, to, view, meta}) =>
      store.onTxn!(source, from, to, 'kv', txn, view, meta)
    )
  }

  return ready.then(() => store)
}

export default lmdbStore
