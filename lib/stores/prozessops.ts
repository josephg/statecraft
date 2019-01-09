// This is a wrapper 'store' around prozess.
//
// The store type is raw. The 'document' is empty, and you can't
// query anything.

import {PClient, Event, SubCbData} from 'prozess-client'
import assert from 'assert'

import * as I from '../interfaces'
import err from '../err'
import {encodeTxn, decodeTxn, decodeEvent, sendTxn} from '../prozess'
import {queryTypes} from '../qrtypes'

// const codec = msgpack.createCodec({usemap: true})

const doNothing = () => {}

const capabilities = {
  // ... Except you can't fetch. :/
  queryTypes: new Set<I.QueryType>(['allkv', 'kv', 'static range', 'range']),
  mutationTypes: new Set<I.ResultType>(['kv']),
}

// TODO: pick a better port.
const prozessStore = (conn: PClient): I.OpStore => {
  const source = conn.source!

  const store: I.OpStore = {
    storeInfo: {
      sources: [source],
      capabilities,
    },

    async mutate(type, _txn, versions, opts = {}) {
      if (type !== 'kv') throw new err.UnsupportedTypeError()
      const txn = _txn as I.KVTxn

      const version = await sendTxn(conn, txn, opts.meta || {}, (versions && versions[source]) || -1, {})
      return {[source]: version!}
    },

    async getOps(query, versions, opts) {
      // We don't need to wait for ready here because the query is passed straight back.
      if (query.type !== 'allkv' && query.type !== 'kv' && query.type !== 'static range') throw new err.UnsupportedTypeError()
      const qops = queryTypes[query.type]

      // We need to fetch ops in the range of (from, to].
      const vs = versions[source] || versions._other
      if (!vs || vs.from === vs.to) return {ops: [], versions: {}}

      const {from, to} = vs

      const data = await conn.getEvents(from + 1, to, {})
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
      conn.close()
    },

    start(v) {
      let expectVersion = -1
      conn.onevents = (events, nextVersion) => {
        if (store.onTxn) {
          events.forEach(event => {
            if (expectVersion !== -1) assert.strictEqual(
              expectVersion, event.version - 1,
              'Error: Prozess version consistency violation. This needs debugging'
            )

            // TODO: Pack & unpack batches.
            const [txn, meta] = decodeTxn(event.data)

            const nextVersion = event.version - 1 + event.batch_size
            store.onTxn!(source, event.version - 1, nextVersion, 'kv', txn, null, meta)

            expectVersion = nextVersion
          })
        }
      }

      return new Promise((resolve, reject) => {
        const vs = v == null ? null : v[source]
        // Should this be vs or vs+1 or something?
        conn.subscribe(vs == null ? -1 : vs + 1, {}, (err, subdata) => {
          if (err) {
            // I'm not sure what to do here. It'll depend on the error
            console.error('Error subscribing to prozess store')
            return reject(err)
          }
          
          // The events will all be emitted via the onevent callback. We'll do catchup there.
          resolve({[source]: subdata!.v_end + 1}) // +1 ??? 
        })
      })
    }
  }

  return store
}

export default prozessStore