import * as I from './interfaces'
import * as err from './err'
import {queryTypes} from './qrtypes'

import binsearch from 'binary-search'
import assert from 'assert'
import {vCmp} from './version'

export interface OpCacheOpts {
  readonly qtype?: I.QueryType,
  readonly maxTime?: number,
  readonly maxNum?: number, // Max number of ops kept for each source.
}

interface OpsEntry<Val> {
  fromV: I.Version,
  toV: I.Version,
  txn: I.Txn<Val>,
  meta: I.Metadata,
}
const cmp = (item: OpsEntry<any>, v: I.Version) => vCmp(item.toV, v)

const opcache = <Val>(opts: OpCacheOpts): {
  onOp(source: I.Source, fromV: I.Version, toV: I.Version, type: I.ResultType, txn: I.Txn<Val>, meta: I.Metadata): void,
  getOps: I.GetOpsFn,
} => {
  const maxNum = opts.maxNum || 0
  // List is sorted in order and accessed using binary search.

  const opsForSource: {[source: string]: OpsEntry<Val>[]} = {}

  const getOpsForSource = (source: I.Source) => {
    let ops = opsForSource[source]
    if (ops == null) opsForSource[source] = ops = []
    return ops
  }

  return {
    onOp(source, fromV, toV, type, txn, meta) {
      const ops = getOpsForSource(source)
      if (ops.length) assert.deepStrictEqual(ops[ops.length - 1].toV, fromV, 'Emitted versions don\'t match')
      ops.push({fromV, toV, txn, meta})
      while (maxNum !== 0 && ops.length > maxNum) ops.shift()
    },

    getOps(query, versions, options = {}) {
      const qtype = query.type
      const qops = queryTypes[qtype]
      assert(qops, 'Missing qops for type ' + qtype)

      let limitOps = options.limitOps || -1

      const vOut: I.FullVersionRange = {}

      const result: I.TxnWithMeta<Val>[] = []
      for (const source in opsForSource) {
        // This is a bit inefficient - if there's lots of sources
        // we're looking through all of them even if the user only
        // wants one. But that shouldn't happen much in practice (right?)
        const ops = opsForSource[source]
        const vs = versions[source] || versions._other
        if (vs == null) continue

        const {from, to} = vs
        let fromidx: number
        if (from.length === 0) fromidx = 0 // From version known.
        else {
          const searchidx = binsearch(ops, <any>from, <any>cmp)
          fromidx = searchidx < 0 ? ~searchidx : searchidx + 1
        }

        if (fromidx >= ops.length) continue

        // Figure out the actual returned version range.
        const vFrom = ops[fromidx].fromV
        let vTo = vFrom

        for (let i = fromidx; i < ops.length; i++) {
          const item = ops[i]
          if (to.length && vCmp(item.toV, to) > 0) break

          // The transaction will be null if the operation doesn't match
          // the supplied query.
          const txn = qops.adaptTxn(item.txn, query.q)
          if (txn != null) result.push({versions:{[source]: item.toV}, txn, meta: item.meta})

          vTo = item.toV
          if (limitOps > 0 && --limitOps === 0) break
        }
        if (vTo !== vFrom) vOut[source] = {from: vFrom, to: vTo}

        if (limitOps === 0) break
      }

      return Promise.resolve({ops: result, versions: vOut})
    },
  }
}

export default opcache