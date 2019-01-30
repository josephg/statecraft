// This is a production grade store backend.
// 
// It supports kv and range queries

import {
  TransactionOptionCode,
  Database,
  // StreamingMode,
  openSync,
  keySelector
} from 'foundationdb'
import * as I from '../interfaces'
import err from '../err'
import genSource from '../gensource'
import msgpack from 'msgpack-lite'
import assert from 'assert'
import debugLib from 'debug'
import fieldOps from '../types/field'
import {queryTypes} from '../qrtypes'
import {V_EMPTY, vEq, vMax, vCmp} from '../version'

// All system-managed keys are at 0x00___.

// For conflicts we want that if two clients both submit operations with non-
// overlapping conflict keys, we want the two operations to not conflict with
// one another. This gives us better throughput. To make that happen, we're
// using versionstamps. The mutation operations themselves will only conflict
// on the keys themselves, not the version. But we also write to a version
// field because we need to be able to watch on a single key to find out about
// updates.

// Statecraft manages anything starting in \0x00 in the keyspace. We could
// instead prefix all content. Ideally, SC would create two directories with
// the directory layer, one for content and the other for configuration. But
// that has to wait for node-foundationdb to implement directories.
// Issue: https://github.com/josephg/node-foundationdb/issues/12

// Note as well that FDB versionstamps are 10 byte big endian values. We're
// using & passing them throughout the system as binary values because JS
// doesn't support integers bigger than 53 bits, let alone 80 bits.
const CONFIG_KEY = Buffer.from('\x00config', 'ascii')

// Using a single key like this will cause thrashing on a single node in the
// FDB cluster, but its somewhat unavoidable given the design. A different
// approach would be to make multiple sources backed by the same FDB store;
// but you can kind of already do that by just making multiple fdb client
// instances and glueing them together with router.

const VERSION_KEY = Buffer.from('\x00v', 'ascii')
const OP_PREFIX = Buffer.from('\x00op', 'ascii')

// Remove this when porting this code to the directory layer.
const START_KEY = Buffer.from('\x01', 'ascii')
const END_KEY = Buffer.from('\xff', 'ascii')

const BUF_EMPTY = Buffer.alloc(0)
// const NULL_VERSION = new Uint8Array(10) //Buffer.alloc(10)
const NULL_VERSION = Buffer.alloc(10)
// const END_VERSION = (new Uint8Array(10)).fill(0xff)//Buffer.alloc(10, 0xff)
const END_VERSION = Buffer.alloc(10, 0xff)

const debug = debugLib('statecraft')

// let running = 0
// setInterval(() => console.log('running', running), 1000).unref()

type Config = {
  sc_ver: number,
  source: string
}

type OpEntry = [
  [I.Key, I.Op][],
  I.Metadata
]

// I'm using a decoder because otherwise there's no good way to read
// stamp/value pairs out of ranges.
const unpackVersion = (data: Buffer): [Buffer, any] => [
  data.slice(0, 10),
  data.length > 10 ? msgpack.decode(data.slice(10)) : undefined
]

const max = (a: Buffer, b: Buffer) => Buffer.compare(a, b) > 0 ? a : b
const min = (a: Buffer, b: Buffer) => Buffer.compare(a, b) > 0 ? b : a
const clamp = (x: Buffer, low: Buffer, high: Buffer) => min(max(x, low), high)

const staticKStoFDBSel = ({k, isAfter}: I.StaticKeySelector) => (
  // isAfter ? keySelector.firstGreaterThan(k) : keySelector.firstGreaterOrEqual(k)
  keySelector(clamp(Buffer.from(k, 'utf8'), START_KEY, END_KEY), isAfter, 1)
)

const kStoFDBSel = ({k, isAfter, offset}: I.KeySelector) => (
  keySelector(clamp(Buffer.from(k, 'utf8'), START_KEY, END_KEY), isAfter, (offset || 0) + 1)
)


export default async function fdbStore(_db?: Database): Promise<I.SimpleStore> {
  // Does it make sense to prefix like this? Once the directory layer is in,
  // we'll use that instead.
  const rawDb = _db || openSync().at('SC')
  const db = rawDb.withValueEncoding({
    pack: msgpack.encode,
    // Only needed pre node-foundationdb 0.9.0
    unpack: (buf) => buf.length === 0 ? undefined : msgpack.decode(buf),
  })

  const opDb = rawDb.at(OP_PREFIX).withValueEncoding({
    pack: msgpack.encode,
    unpack: (buf) => msgpack.decode(buf) as OpEntry
  })

  // First we need to get the sc_ver and source
  const source = await db.doTn(async tn => {
    const config = await tn.get(CONFIG_KEY) as Config | null
    if (config == null) {
      debug('Database was created - no config!')
      const source = genSource()
      tn.set(CONFIG_KEY, {sc_ver: 1, source})
      return source
    } else {
      const {sc_ver, source:dbSource} = config
      assert(sc_ver === 1, 'LDMB database was set up using invalid or old statecraft version.')
      return dbSource as string
    }
  })

  // TODO: Consider implementing a base version so we can prune old operations

  let closed = false
  let cancelWatch: null | (() => void) = null

  const capabilities = {
    // queryTypes: new Set<I.QueryType>(['allkv', 'kv', 'static range', 'range']),
    queryTypes: new Set<I.QueryType>(['allkv', 'kv', 'static range', 'range']),
    mutationTypes: new Set<I.ResultType>(['kv']),
  }

  const store: I.SimpleStore = {
    storeInfo: {
      sources: [source],
      capabilities
    },

    async mutate(type, _txn, versions, opts = {}) {
      if (type !== 'kv') throw new err.UnsupportedTypeError()
      const txn = _txn as I.KVTxn

      debug('mutate', txn)

      // Could be easily, just haven't done it.
      if (opts.conflictKeys && opts.conflictKeys.length) throw Error('conflictKeys not implemented')

      // const expectedVersion = (versions && versions[source] != null) ? versions[source] : version

      const v = (versions ? versions[source] : null)
      if (typeof v === 'number') throw Error('Got invalid numeric version')
      if (v) assert.strictEqual(v.byteLength, 10, 'Version invalid - wrong length')

      const vs = await (await db.doTn(async tn => {
        await Promise.all(Array.from(txn.entries()).map(async ([k, op]) => {
          const oldValue = await tn.getVersionstampPrefixedValue(k)

          if (v != null && oldValue != null && vCmp(oldValue.stamp, v) > 0) {
            throw new err.WriteConflictError('Write conflict in key ' + k)
          }

          const newVal = fieldOps.apply(oldValue ? oldValue.value : null, op)

          // I'm leaving an empty entry in the lmdb database even if newData is
          // null so fetch will correctly report last modified versions.
          // This can be stripped with a periodically updating baseVersion if
          // thats useful.

          // if (newVal === undefined) tn.clear(k)
          // console.log('setting', k, newVal)
          tn.setVersionstampPrefixedValue(k, newVal)
        }))

        // Add the operation to the oplog
        tn.setVersionstampSuffixedKey(OP_PREFIX, [Array.from(txn), opts.meta || {}])

        // Bump the global version. We don't want to conflict here. We really
        // sort of want to set it to MAX(current value, new commit) but the
        // new version will always be higher than the old anyway so it doesn't
        // matter.
        tn.setOption(TransactionOptionCode.NextWriteNoWriteConflictRange)
        tn.setVersionstampPrefixedValue(VERSION_KEY)

        return tn.getVersionstamp()
      })).promise

      // console.log('mutate -> resulting version', vs)
      return {[source]: vs}
    },

    async fetch(query, opts = {}) {
      if (!capabilities.queryTypes.has(query.type)) throw new err.UnsupportedTypeError(`${query.type} not supported by lmdb store`)

      const qops = queryTypes[query.type]
      let bakedQuery: I.Query | undefined
      let maxVersion: Uint8Array | null = null
      let results: I.ResultData

      const vs = await rawDb.doTn(async rawTn => {
        // This could be way cleaner.
        const tn = rawTn.scopedTo(rawDb.withValueEncoding({
          pack() {throw Error('Cannot write')},
          unpack: unpackVersion
        }))

        switch (query.type) {
          case 'kv': {
            results = new Map<I.Key, I.Val>()
            await Promise.all(Array.from(query.q).map(async k => {
              const result = await tn.get(k)
              if (result) {
                const [stamp, value] = result
                if (value != null) results.set(k, opts.noDocs ? 1 : value)
                maxVersion = maxVersion ? vMax(maxVersion, stamp) : stamp
              }
            }))
            break
          }

          case 'allkv': {
            // TODO: Make this work with larger databases (>5mb). Currently
            // this is trying to fetch the whole db contents using a single
            // txn, which will cause problems if the database is nontrivial.

            // There's a few strategies we could implement here:
            //
            // - Lean on fdb's MVCC implementation and create a series of
            //   transactions at the same version
            // - Use a series of transactions at incrementing versions, then
            //   fetch all the operations in the range and run catchup on any
            //   old data that was returned
            // - Implement maxDocs and force the client to implement the 
            //   iterative retry logic

            // Whatever we do should also work on static ranges.

            const resultsList = await tn.getRangeAll(START_KEY, END_KEY)
            results = new Map<I.Key, I.Val>()
            for (const [kbuf, [stamp, value]] of resultsList) {
              results.set(kbuf.toString('utf8'), opts.noDocs ? 1 : value)
              maxVersion = maxVersion ? vMax(maxVersion, stamp) : stamp
            }
            break
          }

          case 'static range': {
            // const q = query.q as I.RangeQuery
            results = await Promise.all(query.q.map(async ({low, high, reverse}) => {
              // This is so clean. Its almost like I designed statecraft with
              // foundationdb in mind... ;)
              return (await tn.getRangeAll(staticKStoFDBSel(low), staticKStoFDBSel(high), {reverse: reverse}))
                .map(([kbuf, [stamp, value]]) => {
                  maxVersion = maxVersion ? vMax(maxVersion, stamp) : stamp
                  return [kbuf.toString('utf8'), opts.noDocs ? 1 : value] as [I.Key, I.Val]
                }) //.filter(([k, v]) => v != undefined)
            }))
            break
          }

          case 'range': {
            // There's a bunch of ways I could write this, but a bit of copy + pasta is the simplest.
            // bakedQuery = {type: 'static range', q:[]}
            const baked: I.StaticRangeQuery = []
            results = await Promise.all(query.q.map(async ({low, high, reverse, limit}, i) => {
              // console.log('range results', (await tn.getRangeAll(kStoFDBSel(low), kStoFDBSel(high), {reverse: reverse, limit: limit})).length)
              const vals = (await tn.getRangeAll(kStoFDBSel(low), kStoFDBSel(high), {reverse: reverse, limit: limit}))
                .map(([kbuf, [stamp, value]]) => {
                  maxVersion = maxVersion ? vMax(maxVersion, stamp) : stamp
                  // console.log('arr entry', [kbuf.toString('utf8'), value])
                  return [kbuf.toString('utf8'), opts.noDocs ? 1 : value] as [I.Key, I.Val]
                }) //.filter(([k, v]) => v != undefined)

              // Note: These aren't tested thoroughly yet. Probably a bit broken.
              baked[i] = vals.length ? {
                low: {k: reverse ? vals[vals.length-1][0] : vals[0][0], isAfter: !!reverse},
                high: {k: reverse ? vals[0][0] : vals[vals.length-1][0], isAfter: !reverse},
                reverse
              } : {
                low: {k: low.k, isAfter: low.isAfter},
                high: {k: low.k, isAfter: low.isAfter},
                reverse
              }

              // console.log('range ->', vals)
              return vals
            }))
            // console.log('range query ->', results)
            bakedQuery = {type: 'static range', q: baked}
            break
          }

          default: throw new err.UnsupportedTypeError(`${query.type} not supported by fdb store`)
        }

        return rawTn.getVersionstampPrefixedValue(VERSION_KEY)
      })

      return {
        bakedQuery,
        results,
        versions: {[source]: {
          from: maxVersion || NULL_VERSION,
          to: vs ? vs.stamp : NULL_VERSION
        }}
      }
    },

    async getOps(query, versions, opts = {}) {
      const qtype = query.type
      const qops = queryTypes[qtype]

      const limitOps = opts.limitOps || -1
      const vOut: I.FullVersionRange = {}

      const reqV = versions[source] || versions._other
      if (reqV == null) return {ops: [], versions: {}}
      let {from, to} = reqV
      if (from.length === 0) from = NULL_VERSION
      if (to.length === 0) to = END_VERSION
      if (typeof from === 'number' || typeof to === 'number') throw Error('Invalid version request')
      if (vCmp(from, to) >= 0) return {ops: [], versions: {}}

      // TODO: This will have some natural limit based on how big a
      // transaction can be. Split this up across multiple transactions using
      // getRangeBatch (we don't need write conflicts or any of that jazz).
      const ops = await opDb.getRangeAll(
        keySelector.firstGreaterThan(Buffer.from(from)),
        keySelector.firstGreaterThan(Buffer.from(to))
      )

      const result = [] as I.TxnWithMeta[]

      for (let i = 0; i < ops.length; i++) {
        const [version, [txnArr, meta]] = ops[i]
        // console.log('ops', version, txnArr, meta)
        const txn = qops.adaptTxn(new Map<I.Key, I.Val>(txnArr), query.q)
        if (txn != null) result.push({txn, meta, versions: {[source]: version}})
      }

      return {
        ops: result,
        versions: {
          [source]: {
            from,
            to: ops.length ? ops[ops.length-1][0] : from
          }
        }
      }
    },

    close() {
      closed = true
      cancelWatch && cancelWatch()
      // TODO: And close the database properly.
    },
  }

  const opwatcher = async () => {
    try {
      // running++

      let v0 = (await rawDb.get(VERSION_KEY)) || BUF_EMPTY
      // console.log('initial version', v0)

      while (!closed) {
        const watch = await rawDb.getAndWatch(VERSION_KEY)
        const {value: version, promise} = watch
        if (version != null && !v0.equals(version)) {

          // TODO: Probably should chunk this?
          const ops = await opDb.getRangeAll(
            keySelector.firstGreaterThan(v0),
            keySelector.firstGreaterThan(version!)
          )

          // console.log('version', v0, version, ops)

          for (let i = 0; i < ops.length; i++) {
            const [version, v] = ops[i]
            const [op, meta] = v

            // console.log('v', v0, version)
            assert(vCmp(v0, version) < 0)
            if (store.onTxn) store.onTxn(
              source,
              v0,
              version,
              'kv', new Map(op), new Map()/*resultingView TODO!!!*/, meta)

            v0 = version
          }
        }

        // If the store was closed between the top of the loop and this point
        // (async, remember!) then we explicitly close now. We need to cancel
        // the watch immediately because otherwise the node event loop would
        // be held open.
        if (closed) { watch.cancel(); break }
        else cancelWatch = watch.cancel.bind(watch)
        
        // This promise should resolve to false when the watch was cancelled.
        // TODO: Check what happens when the database connection is
        // interrupted.
        await promise
      }

    } catch (e) {
      console.error('Unhandled error in FDB operation watch process', e.message, e.stack)
      // Throw to the global exception handler, which will normally crash the process.
      process.emit('uncaughtException', e)
    }
    // running--
  }

  opwatcher()

  return store
}
