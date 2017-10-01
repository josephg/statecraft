// I'm not sure the best way to structure this. This is some utility functions for interacting
// with prozess stores.

import {Event, PClient, SubCbData} from 'prozess-client'
import * as I from './types/interfaces'
import msgpack = require('msgpack-lite')

export const encodeTxn = (txn: I.KVTxn) => msgpack.encode(Array.from(txn))
export const decodeTxn = (data: NodeBuffer) => new Map<I.Key, I.Op>(msgpack.decode(data))

// TODO: This should work with batches.
export const decodeEvent = (event: Event, source: I.Source): I.TxnWithMeta => ({
  versions: {[source]: event.version},
  txn: decodeTxn(event.data),
})

export function sendTxn(client: PClient,
    txn: I.KVTxn,
    version: I.Version,
    opts: object,
    callback: I.Callback<I.Version>) {
  const data = encodeTxn(txn)

  // TODO: This probably doesn't handle a missing version properly.
  // TODO: Add read conflict keys through opts.
  client.send(data, {
    targetVersion: version >= 0 ? version + 1 : version,
    conflictKeys: Array.from(txn.keys())
  }, callback)
}

// Returns ops in SC style - range (from, to].
// export function getOps(client: PClient,
//     from: I.Version,
//     to: I.Version,
//     callback: I.Callback<SubCbData>) {
//   client.getEvents(from + 1, to, {}, callback)
// }
