// I'm not sure the best way to structure this. This is some utility functions for interacting
// with prozess stores.

import * as I from './interfaces'
import {Event, PClient, SubCbData} from 'prozess-client'
import msgpack from 'msgpack-lite'

export const encodeTxn = (txn: I.KVTxn, meta: I.Metadata) => msgpack.encode([Array.from(txn), meta])
export const decodeTxn = (data: Buffer): [I.KVTxn, I.Metadata] => {
  const [txn, meta] = msgpack.decode(data)
  return [new Map<I.Key, I.Op>(txn), meta]
}

// TODO: This should work with batches.
export const decodeEvent = (event: Event, source: I.Source): I.TxnWithMeta => {
  const [txn, meta] = decodeTxn(event.data)
  return { versions: {[source]: event.version}, txn, meta }
}

export function sendTxn(client: PClient,
    txn: I.KVTxn,
    meta: I.Metadata,
    expectedVersion: I.Version,
    opts: object): Promise<I.Version> {
  const data = encodeTxn(txn, meta)

  // TODO: This probably doesn't handle a missing version properly.
  // TODO: Add read conflict keys through opts.
  return client.send(data, {
    // targetVersion: expectedVersion === -1 ? -1 : expectedVersion + 1,
    targetVersion: expectedVersion + 1,
    conflictKeys: Array.from(txn.keys()),
  })
}

// Returns ops in SC style - range (from, to].
// export function getOps(client: PClient,
//     from: I.Version,
//     to: I.Version,
//     callback: I.Callback<SubCbData>) {
//   client.getEvents(from + 1, to, {}, callback)
// }
