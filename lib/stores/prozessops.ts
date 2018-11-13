// This is a wrapper 'store' around prozess.
//
// The store type is raw. The 'document' is empty, and you can't
// query anything.

import {reconnecter, Event, SubCbData} from 'prozess-client'
import assert from 'assert'

import * as I from '../types/interfaces'
import err from '../err'
import {encodeTxn, decodeTxn, decodeEvent, sendTxn} from '../prozess'

// const codec = msgpack.createCodec({usemap: true})

const doNothing = () => {}

const capabilities = {
  queryTypes: new Set<I.QueryType>(['allkv']),
  mutationTypes: new Set<I.ResultType>(['resultmap']),
}

// TODO: pick a better port.
const prozessStore = (port: number = 9999, hostname: string = 'localhost'): Promise<I.SimpleStore> => {
  return new Promise((resolve, reject) => {
    const conn = reconnecter(port, hostname, (error, _source) => {
      if (error) return reject(error)
      const source = _source!

      const store: I.SimpleStore = {
        storeInfo: {
          sources: [source],
          capabilities,
        },

        fetch(query, opts) {
          return Promise.reject(new err.UnsupportedTypeError('Unsupported query type'))
        },

        async mutate(type, _txn, versions, opts = {}) {
          if (type !== 'resultmap') throw new err.UnsupportedTypeError()
          const txn = _txn as I.KVTxn

          const version = await sendTxn(conn, txn, opts.meta || {}, (versions && versions[source]) || -1, {})
          return {[source]: version!}
        },

        async getOps(query, versions, opts) {
          if (query.type !== 'allkv') throw new err.UnsupportedTypeError()

          // We need to fetch ops in the range of (from, to].
          const vs = versions[source] || versions._other
          if (!vs) return {ops: [], versions: {}}

          const {from, to} = vs

          const data = await conn.getEvents(from + 1, to, {})

          const ops = data!.events.map(event => decodeEvent(event, source))

          return {
            ops,
            versions: {[source]: {from: data!.v_start - 1, to: data!.v_end}}
          }
        },

        close() {
          conn.close()
        },

      }

      conn.subscribe(-1, {}, (err, subdata) => {
        if (err) {
          // I'm not sure what to do here. It'll depend on the error
          return console.error('Warning: Ignoring subscribe error', err)
        }

        if (store.onTxn) {
          subdata!.events.forEach(event => {
            // TODO: Pack & unpack batches.
            const [txn, meta] = decodeTxn(event.data)
            store.onTxn!(source, event.version, event.version + 1, 'resultmap', txn, meta)
          })
        }
      })

      resolve(store)
    })
  })
}

export default prozessStore