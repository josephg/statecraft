import * as I from './types/interfaces'
import * as err from './err'
import queryops from './types/queryops'

import binsearch = require('binary-search')
import assert = require('assert')

export interface OpCacheOpts {
  readonly qtype?: I.QueryType,
  readonly maxTime?: number,
  readonly maxNum?: number, // Max number of ops kept for each source.
}

interface OpsEntry {fromV: I.Version, toV: I.Version, txn: I.Txn}
const cmp = (item: OpsEntry, v: I.Version) => item.toV - v

const opcache = (opts: OpCacheOpts): {
  onOp(source: I.Source, fromV: I.Version, toV: I.Version, type: I.ResultType, txn: I.Txn): void,
  getOps: I.GetOpsFn,
} => {
  const maxNum = opts.maxNum || 0
  // List is sorted in order and accessed using binary search.

  const opsForSource: {[source: string]: OpsEntry[]} = {}

  const getOpsForSource = (source: I.Source) => {
    let ops = opsForSource[source]
    if (ops == null) opsForSource[source] = ops = []
    return ops
  }

  return {
    onOp(source, fromV, toV, type, txn) {
      const ops = getOpsForSource(source)
      if (ops.length) assert(ops[ops.length - 1].toV === fromV, 'Emitted versions don\'t match')
      ops.push({fromV, toV, txn})
      while (maxNum !== 0 && ops.length > maxNum) ops.shift()
    },
    getOps(qtype, query, versions, options, callback) {
      const qops = queryops[qtype]
      assert(qops, 'Missing qops for type ' + qtype)

      let limitOps = options.limitOps || -1

      const vOut: I.FullVersionRange = {}

      const result: {source: I.Source, v: I.Version, txn: I.Txn}[] = []
      for (const source in versions) {
        const ops = opsForSource[source]
        if (ops == null) continue

        const {from, to} = versions[source]
        let fromidx: number
        if (from === -1) fromidx = 0 // From version known.
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
          if (item.toV > to) break
          result.push({source, v: item.toV, txn: qops.filterTxn(item.txn, query)})
          vTo = item.toV
          if (limitOps > 0 && --limitOps === 0) break
        }
        if (vTo !== vFrom) vOut[source] = {from: vFrom, to: <I.Version>vTo}

        if (limitOps === 0) break
      }

      return callback(null, {ops: result, versions: vOut})
    },
  }
}

export default opcache