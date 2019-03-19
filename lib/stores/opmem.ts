// This is a trivial implementation of an in-memory op store. This is designed
// for use with kvmem when it has no other inner store to use as a source of
// truth. You should never use this with lmdbstore (or any other persistent
// store).

import * as I from '../interfaces'
import err from '../err'
import {queryTypes} from '../qrtypes'
import {V64, v64ToNum, vInc, vEq} from '../version'
import genSource from '../gensource'

// const capabilities = {
//   // This will be filtered by the actual store.
//   // queryTypes: new Set<I.QueryType>(['allkv', 'kv', 'static range', 'range']),
//   queryTypes: new Set<I.QueryType>([]),
//   mutationTypes: new Set<I.ResultType>(['kv', 'single']),
// }

export interface Opts {
  initialVersion?: I.Version,
  source?: I.Source,
  readOnly?: boolean,
}

export interface Trigger<Val> {
  // internalDidChange(type: I.ResultType, txn: I.Txn, versions: I.FullVersion, opts: I.MutateOptions): void

  // Apply and notify that a change happened in the database. This is useful
  // so if the memory store wraps an object that is edited externally, you can
  // update listeners.
  internalDidChange(type: I.ResultType, txn: I.Txn<Val>, meta: I.Metadata, toVersion?: I.Version): I.Version
}

// TODO: Consider inlining opcache in here.
const opmem = <Val>(opts: Opts = {}): I.OpStore<Val> & Trigger<Val> => {
  const source = opts.source || genSource()
  let version = opts.initialVersion || V64(0)
  let started = false
  const isReadonly = opts.readOnly

  const store: I.OpStore<Val> & Trigger<Val> = {
    storeInfo: {
      sources: [source],
      capabilities: {
        queryTypes: new Set(),
        mutationTypes: opts.readOnly ? new Set() : new Set<I.ResultType>(['kv', 'single'])
      }
    },

    internalDidChange(type, txn, meta, toV) {
      const fromV = version
      if (!toV) toV = vInc(version)

      version = toV

      if (started) this.onTxn!(source, fromV, toV, type, txn, meta || {})
      return toV
    },

    async mutate(type, txn, versions = [], opts = {}) {
      if (isReadonly) throw new err.UnsupportedTypeError('Cannot write to readonly store')
      const reqV = versions[0]
      
      // Because we don't store the operations here, the operation's version must match exactly.
      if (reqV != null && !vEq(reqV, version)) throw new err.VersionTooOldError()

      return [this.internalDidChange(type, txn, opts.meta || {})]
    },

    start() {
      started = true
      return Promise.resolve([version])
    },

    close() {},

  }

  return store
}

export default opmem