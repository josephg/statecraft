import * as I from './interfaces'
import * as err from './err'
import {queryTypes} from './qrtypes'

import binsearch from 'binary-search'
import {vCmp, vEq} from './version'

export interface OpCacheOpts {
  readonly sources: I.Source[],
  readonly qtype?: I.QueryType,
  readonly maxTime?: number, // in milliseconds. 0 = ignore.
  readonly maxNum?: number, // Max number of ops kept for each source. 0 = ignore
}

interface OpsEntry<Val> {
  fromV: I.Version,
  toV: I.Version,
  txn: I.Txn<Val>,
  meta: I.Metadata,
  ctime: number,
}
const cmp = (item: OpsEntry<any>, v: I.Version) => vCmp(item.toV, v)

const opcache = <Val>(opts: OpCacheOpts): {
  onOp(source: I.Source, fromV: I.Version, toV: I.Version, type: I.ResultType, txn: I.Txn<Val>, meta: I.Metadata): void,
  getOps: I.GetOpsFn,
} => {
  const maxNum = opts.maxNum || 0
  const maxTime = opts.maxTime || 0
  // List is sorted in order and accessed using binary search.

  // source => list of ops entries sorted by version
  const opsForSource: OpsEntry<Val>[][] = new Array(opts.sources.length)

  const getOpsForSource = (source: I.Source) => {
    const idx = opts.sources.indexOf(source)

    // There might be times we want to silently ignore this error, but until
    // we find them this code will throw.
    if (idx < 0) throw Error('Cannot get ops for unknown source')

    let ops = opsForSource[idx]
    if (ops == null) opsForSource[idx] = ops = []
    return ops
  }

  return {
    onOp(source, fromV, toV, type, txn, meta) {
      const ops = getOpsForSource(source)
      if (ops.length && !vEq(ops[ops.length - 1].toV, fromV)) throw Error('Emitted versions don\'t match')
      ops.push({fromV, toV, txn, meta, ctime: Date.now()})

      while (maxNum !== 0 && ops.length > maxNum) ops.shift()

      const now = Date.now()
      while (maxTime !== 0 && ops.length && ops[0].ctime < now - maxTime) ops.shift()
    },

    getOps(query, versions, options = {}) {
      const qtype = query.type
      const qops = queryTypes[qtype]
      if (qops == null) throw Error('Missing qops for type ' + qtype)

      let limitOps = options.limitOps || -1

      const vOut: I.FullVersionRange = []

      const result: I.TxnWithMeta<Val>[] = []
      for (let si = 0; si < opsForSource.length; si++) {
        // This is a bit inefficient - if there's lots of sources
        // we're looking through all of them even if the user only
        // wants one. But that shouldn't happen much in practice (right?)
        const ops = opsForSource[si]
        if (ops == null) continue
        const vs = versions[si] //|| versions._other
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
          const versions = []
          versions[si] = item.toV
          if (txn != null) result.push({versions, txn, meta: item.meta})

          vTo = item.toV
          if (limitOps > 0 && --limitOps === 0) break
        }
        if (vTo !== vFrom) vOut[si] = {from: vFrom, to: vTo}

        if (limitOps === 0) break
      }

      // console.log('opcache', result, vOut)
      return Promise.resolve({ops: result, versions: vOut})
    },
  }
}

export default opcache