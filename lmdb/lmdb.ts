// This file implements an lmdb kv store on top of prozess.
//
// For now it bootstraps by replaying the event log.

import assert from 'assert'
import lmdb from 'node-lmdb'
import fs from 'fs'
import msgpack from 'msgpack-lite'
import debugLib from 'debug'

import fieldOps from '../types/field'
import {queryTypes} from '../qrtypes'
import sel from '../sel'
import {vMax, vCmp} from '../version'

import * as I from '../interfaces'
import err from '../err'
import { bitSet, hasBit } from '../bit'
import SubGroup from '../subgroup'
import resolvable from '../resolvable'

const debug = debugLib('statecraft')
const CONFIG_KEY = Buffer.from('\x01config')
const VERSION_KEY = Buffer.from('\x01v')

// Valid keys are in the [0x02, 0xff) range.
const START_KEY = '\x02'
const END_KEY = '\xff'

const START_SEL = sel(START_KEY, false)
const END_SEL = sel(END_KEY, false)
const V_ZERO = new Uint8Array(8)

// ... At some point it'll make sense for the caller to get more detailed notifications about catchup state.
// For now the promise won't be called until catchup is complete.
const lmdbStore = <Val>(inner: I.Store<Val>, location: string): Promise<I.Store<Val>> => {
  const env = new lmdb.Env()

  // console.log('inner', inner)
  if (inner.storeInfo.sources.length !== 1) {
    // It would be trivial though.
    throw new Error('LMDB store with multiple sources not implemented')
  }

  const source: I.Source = inner.storeInfo.sources[0]

  // Check that the directory exists.
  try { fs.mkdirSync(location) }
  catch(e) { if (e.code !== 'EEXIST') throw e }

  env.open({path: location, maxDbs: 2, noTls: true})

  const dbi = env.openDbi({name: null, create: true})
  // const configdb = env.openDbi({name: 'config', create: true})

  // Note: I'm using 'native' Prozess version numbers, so the local store
  // starts at version 0 and event 1 moves us to version 1.
  let version: I.Version = new Uint8Array()

  const setVersion = (txn: lmdb.Txn, v: I.Version) => {
    version = v
    txn.putBinary(dbi, VERSION_KEY, Buffer.from(version))
  }

  // Ok, first do catchup.
  {
    const txn = env.beginTxn()
    const configBytes = txn.getBinary(dbi, CONFIG_KEY)
    if (configBytes == null) {
      // console.log('Database was created - no config!')
      txn.putBinary(dbi, CONFIG_KEY, msgpack.encode({sc_ver: 1, source}))
      setVersion(txn, new Uint8Array(8))
    } else {
      const {sc_ver, source:dbSource} = msgpack.decode(configBytes)
      assert(sc_ver === 1, 'LDMB database was set up using invalid or old statecraft version.')
      assert(dbSource === source, `LDMB database at ${location} is invalid. Delete and restart`)
      version = new Uint8Array(txn.getBinary(dbi, VERSION_KEY))
    }
    txn.commit()
  }
  debug('Opened database at version', version)

  const ready = resolvable()
  // const ready = inner.start!([version])

  // TODO: Generate these based on the opstore.
  const capabilities = {
    queryTypes: bitSet(I.QueryType.AllKV, I.QueryType.KV, I.QueryType.StaticRange, I.QueryType.Range),
    mutationTypes: bitSet(I.ResultType.KV),
  }  

  const decode = (bytes: Buffer | null): [Uint8Array, any] => {
    if (bytes == null) return [V_ZERO, null]
    else {
      const [vBuf, data] = msgpack.decode(bytes)
      return [new Uint8Array(vBuf), data]
    }
  }

  const rawGet = (txn: lmdb.Txn, k: I.Key) => decode(txn.getBinaryUnsafe(dbi, k))

  // TODO: Probably cleaner to write this as iterators? This is simpler / more
  // understandable though.
  const getKVResults = (dbTxn: lmdb.Txn, query: Iterable<I.Key>, opts: I.FetchOpts, resultsOut: Map<I.Key, Val>) => {
    let maxVersion = V_ZERO

    for (let k of query) {
      const [lastMod, doc] = rawGet(dbTxn, k)
      if (doc != null) resultsOut.set(k, opts.noDocs ? 1 : doc)
      // Note we update maxVersion even if the document is null.
      maxVersion = vMax(maxVersion, lastMod)
    }

    return maxVersion
  }

  const getAllResults = (dbTxn: lmdb.Txn, opts: I.FetchOpts, resultsOut: Map<I.Key, Val>) => {
    let maxVersion = V_ZERO
    const cursor = new lmdb.Cursor(dbTxn, dbi)
    let k = cursor.goToRange('\x02') // positioned right after config key
    while (k != null) {
      const bytes = cursor.getCurrentBinaryUnsafe()
      const [lastMod, doc] = decode(bytes)
      if (doc != null) resultsOut.set(k as string, opts.noDocs ? 1 : doc)
      maxVersion = vMax(maxVersion, lastMod)

      k = cursor.goToNext()
    }
    cursor.close()

    return maxVersion
  }

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
    let {k, isAfter} = sel
    let offset = sel.offset || 0

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

    cursor.close()
    return {low: lowBake, high: highBake, reverse}
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

  const fetch: I.FetchFn<Val> = (query, opts = {}) => {
    if (!hasBit(capabilities.queryTypes, query.type)) return Promise.reject(new err.UnsupportedTypeError(`${query.type} not supported by lmdb store`))
    const qops = queryTypes[query.type]
    let bakedQuery: I.Query | undefined

    const dbTxn = env.beginTxn({readOnly: true})

    let results: I.ResultData<Val>
    // KV txn. Query is a set of keys.
    let maxVersion: I.Version

    switch (query.type) {
      case I.QueryType.KV:
        results = new Map<I.Key, Val>()
        maxVersion = getKVResults(dbTxn, query.q, opts, results)
        break
      case I.QueryType.AllKV:
        results = new Map<I.Key, Val>()
        maxVersion = getAllResults(dbTxn, opts, results)
        break

      case I.QueryType.Range:
        bakedQuery = {type: I.QueryType.StaticRange, q: query.q.slice()}
      case I.QueryType.StaticRange: {
        const q = query.q as I.RangeQuery // | I.StaticRangeQuery
        maxVersion = V_ZERO
        results = q.map((range) => {
          const staticRange = (query.type === I.QueryType.Range) ? bakeRange(dbTxn, range) : (range as I.StaticRange)
          const docs = [] // A map might be nicer.
          for (const [k, bytes] of rangeContentIter(dbTxn, staticRange)) {
            const [lastMod, doc] = decode(bytes)
            maxVersion = vMax(maxVersion, lastMod)
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

    dbTxn.abort()

    // console.log('lmdb fetch', results, maxVersion, version)
    return Promise.resolve({
      bakedQuery,
      results,
      versions: [{from: maxVersion, to: version}]
    })
  }

  const subGroup = new SubGroup({initialVersion: [version], fetch, getOps: inner.getOps.bind(inner)})

  const store: I.Store<Val> = {
    storeInfo: {
      uid: `lmdb(${inner.storeInfo.uid})`, // TODO: Maybe just re-expose inner.storeinfo.uid? All kv wraps should be identical
      sources: [source],
      capabilities,
    },

    async mutate(type, _txn, versions, opts = {}) {
      // TODO: Refactor this out by implementing internalDidChange
      if (type !== I.ResultType.KV) throw new err.UnsupportedTypeError()
      const txn = _txn as I.KVTxn<Val>

      // await ready

      debug('mutate', txn)

      const expectedVersion = (versions && versions[0] != null) ? versions[0]! : version

      // Check that the transaction applies cleanly.
      const dbTxn = env.beginTxn({readOnly: true})
      for (const [k, op] of txn) {
        const [v, data] = rawGet(dbTxn, k)
        if (expectedVersion.length && vCmp(v, expectedVersion) > 0) {
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
      // const resultVersion = await sendTxn(client, txn, opts.meta || {}, version, {})
      
      // We know its valid at the current version, so we're ok to pass that here.
      const innerV = versions == null ? [version] : versions.slice()
      innerV[0] = version
      const result = await inner.mutate(I.ResultType.KV, txn, innerV, opts)

      debug('mutate cb', result)
      return result
    },

    fetch,
    getOps: inner.getOps.bind(inner),
    subscribe: subGroup.create.bind(subGroup),

    close() {
      // close the lmdb database.
      dbi.close()
      env.close()

      // We take ownership, so this makes sense.
      inner.close()
    },
  }
  
  ;(async () => {
    for await (const cu of inner.subscribe({type: I.QueryType.AllKV, q: true}, {fromVersion: [version]})) {
      if (cu.replace) throw new Error('Inner store replacing data is not implemented')
      
      let evtTxn = env.beginTxn()
      let nextVersion = new Uint8Array()

      for (let i = 0; i < cu.txns.length; i++) {
        const {txn, meta, versions} = cu.txns[i]
        const toV = versions[0]
        if (toV == null) throw new Error('Invalid catchup data - null version in txn')

        const txn_ = txn as I.KVTxn<Val>

        for (const [k, op] of txn_) {
          // const oldData = fieldOps.create(rawGet(dbTxn, k)[0], op)
          const oldData = rawGet(evtTxn, k)[1]
      
          const newData = fieldOps.apply(oldData, op)
          // console.log('updated key', k, 'from', oldData, 'to', newData)
      
          // I'm leaving an empty entry in the lmdb database even if newData is
          // null so fetch will correctly report last modified versions.
          // This can be stripped with a periodically updating baseVersion if
          // thats useful.
          evtTxn.putBinary(dbi, k, msgpack.encode([Buffer.from(toV), newData]))
        }
        // nextVersion = toV
      }
      nextVersion = cu.toVersion[0]!

      // TODO: Consider setting subgroup minversion here.
      
      subGroup.onOp(0, version, cu.txns)

      // console.log('setversion', nextVersion)
      setVersion(evtTxn, nextVersion)
      evtTxn.commit()

      if (cu.caughtUp) ready.resolve()
    }
  })()

  return ready.then(() => store)
  // return Promise.resolve(store)
}

export default lmdbStore
