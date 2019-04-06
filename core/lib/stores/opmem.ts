// This is a trivial implementation of an in-memory op store. This is designed
// for use with kvmem when it has no other inner store to use as a source of
// truth. You should never use this with lmdbstore (or any other persistent
// store).

import * as I from '../interfaces'
import err from '../err'
import {queryTypes} from '../qrtypes'
import {V64, v64ToNum, vInc, vEq, vCmp, V_EMPTY, vRangeTo} from '../version'
import genSource from '../gensource'
import { bitSet } from '../bit'
import SubGroup from '../subgroup'

// TODO: Shouldn't need binsearch.
import binsearch from 'binary-search'

export interface Opts {
  readonly initialVersion?: I.Version,
  readonly source?: I.Source,
  readonly readOnly?: boolean,
  readonly maxOps?: number, // Max number of ops kept for each source. 0 = ignore
}

export interface Trigger<Val> {
  // Apply and notify that a change happened in the database. This is useful
  // so if the memory store wraps an object that is edited externally, you can
  // update listeners.
  internalDidChange(type: I.ResultType, txn: I.Txn<Val>, meta: I.Metadata, toVersion?: I.Version): I.Version
}

interface OpsEntry<Val> {
  fromV: I.Version,
  toV: I.Version,
  txn: I.Txn<Val>,
  meta: I.Metadata,
  // ctime: number,
}

const cmp = (item: OpsEntry<any>, v: I.Version) => vCmp(item.toV, v)

// TODO: Consider inlining opcache in here.
const opmem = <Val>(opts: Opts = {}): I.Store<Val> & Trigger<Val> => {
  const source = opts.source || genSource()
  const initialVersion = opts.initialVersion || V64(0)
  const isReadonly = opts.readOnly
  
  const ops: OpsEntry<Val>[] = []
  const maxOps = opts.maxOps || 0

  let version = initialVersion

  const getOpsSync = (query: I.Query, versions: I.FullVersionRange, options: I.GetOpsOptions = {}): I.GetOpsResult<Val> => {
    // TODO: This is awful - I've copy+pasta'ed this big function from opcache.
    // Figure out a decent way to do this - maybe opcache should be another store too?
    const qtype = query.type
    const qops = queryTypes[qtype]
    if (qops == null) throw Error('Missing qops for type ' + qtype)

    let limitOps = options.limitOps || -1

    const result: I.TxnWithMeta<Val>[] = []

    const vs = versions[0]
    if (vs == null) return {ops: result, versions: []}

    const {from, to} = vs
    let fromidx: number
    if (from.length === 0) fromidx = 0 // From start
    else {
      // TODO: The version numbers here are sequential, so we should be able to remove binsearch.
      const searchidx = binsearch(ops, <any>from, <any>cmp)
      fromidx = searchidx < 0 ? ~searchidx : searchidx + 1
    }

    if (fromidx >= ops.length) return {ops: result, versions: [{from:version, to:version}]}

    // Figure out the actual returned version range.
    const vFrom = ops[fromidx].fromV
    let vTo = vFrom

    for (let i = fromidx; i < ops.length; i++) {
      const item = ops[i]
      if (to.length && vCmp(item.toV, to) > 0) break

      // The transaction will be null if the operation doesn't match
      // the supplied query.
      const txn = qops.adaptTxn(item.txn, query.q)
      if (txn != null) result.push({versions: [item.toV], txn, meta: item.meta})

      vTo = item.toV
      if (limitOps > 0 && --limitOps === 0) break
    }

    // console.log('opcache', result, vOut)
    return {ops: result, versions: [{from: vFrom, to: vTo}]}
  }
  const getOps: I.GetOpsFn<Val> = (q, v, opts) => Promise.resolve(getOpsSync(q, v, opts))

  const subgroup = new SubGroup({getOps, initialVersion: [version]})

  const store: I.Store<Val> & Trigger<Val> = {
    storeInfo: {
      uid: `opmem(${source})`,
      sources: [source],
      capabilities: {
        queryTypes: 0,
        // Is this right? Maybe we should just set all the bits.
        mutationTypes: opts.readOnly ? 0 : bitSet(I.ResultType.Single, I.ResultType.KV)
      }
    },

    fetch() {
      throw new err.UnsupportedTypeError()
    },
    
    getOps,

    subscribe(q, opts = {}) {
      return subgroup.create(q, opts)
    },

    internalDidChange(type, txn, meta, toV) {
      const fromV = version
      if (!toV) toV = vInc(version)

      ops.push({ fromV: version, toV, txn, meta })
      while (maxOps !== 0 && ops.length > maxOps) ops.shift()
      
      version = toV
      // console.log('internalDidChange', toV)
      subgroup.onOp(0, fromV, [{txn, meta, versions: [toV]}])
      return toV
    },

    async mutate(type, txn, versions = [], opts = {}) {
      if (isReadonly) throw new err.UnsupportedTypeError('Cannot write to readonly store')
      const reqV = versions[0]
    
      // Opmem is blind wrt operation contents.
      if (reqV != null && !vEq(reqV, version)) throw new err.VersionTooOldError()

      return [this.internalDidChange(type, txn, opts.meta || {})]
    },

    close() {},

  }

  return store
}

export default opmem