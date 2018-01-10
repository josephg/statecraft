// This is a wrapper 'store' around prozess.
//
// The store type is raw. The 'document' is empty, and you can't
// query anything.

import {reconnecter, Event, SubCbData} from 'prozess-client'
import assert = require('assert')

import * as I from '../types/interfaces'
import * as err from '../err'
import {encodeTxn, decodeTxn, decodeEvent, sendTxn} from '../prozess'

// const codec = msgpack.createCodec({usemap: true})

const doNothing = () => {}

const capabilities = {
  queryTypes: new Set<I.QueryType>(['allkv']),
  mutationTypes: new Set<I.ResultType>(['resultmap']),
}

// TODO: pick a better port.
const prozessStore = (port: number = 9999, hostname: string = 'localhost',
storeCallback: I.Callback<I.SimpleStore>): void => {
  const conn = reconnecter(port, hostname, (error, _source) => {
    if (error) return storeCallback(error)
    const source = _source!

    const store: I.SimpleStore = {
      sources: [source],

      capabilities,

      fetch(qtype, query, opts, callback) {
        return callback(Error('Unsupported query type'))
      },

      mutate(type, _txn, versions, opts, callback) {
        if (type !== 'resultmap') return callback(new err.UnsupportedTypeError())
        const txn = _txn as I.KVTxn

        sendTxn(conn, txn, versions[source] || -1, {}, (err, version) => {
          if (err) callback(err)
          else callback(null, {[source]: version!})
        })
      },

      getOps(qtype, query, versions, opts, callback) {
        if (qtype !== 'allkv') return callback(new err.UnsupportedTypeError())

        // We need to fetch ops in the range of (from, to].
        const vs = versions[source] || versions._other
        if (!vs) return callback(null, {ops: [], versions: {}})

        const {from, to} = vs

        conn.getEvents(from + 1, to, {}, (err, data: SubCbData | undefined) => {
          if (err) return callback(err)

          const ops = data!.events.map(event => decodeEvent(event, source))

          callback(null, {
            ops,
            versions: {[source]: {from: data!.v_start - 1, to: data!.v_end}}
          })
        })
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
          const txn = decodeTxn(event.data)
          store.onTxn!(source, event.version, event.version + 1, 'resultmap', txn)
        })
      }
    })

    storeCallback(null, store)
  })
}

export default prozessStore