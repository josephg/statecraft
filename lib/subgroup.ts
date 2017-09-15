
// import {
//   Subscription,
//   QueryType,
//   Listener,
//   Source,
//   Version,
//   Txn,
//   Op,
//   KVQuery,
//   Key
// } from '../common/interfaces'
import * as I from '../common/interfaces'

import {registry as queryops} from '../common/queryops'
import assert = require('assert')
import {fieldType} from './docop'
import {QueryOps} from '../common/type'

interface Sub extends I.Subscription {
  _onOp(source: I.Source, version: I.Version, txn: I.Txn): void
  [prop: string]: any
}

type SetOrMap<T> = Map<T, any> | Set<T>
function eachIntersect<T>(c1: SetOrMap<T>, c2: SetOrMap<T>, fn: (v:T) => void) {
  // This works on maps and sets.
  if (c1.size > c2.size) {
    for (let k of c2.keys()) if (c1.has(k)) fn(k)
  } else {
    for (let k of c1.keys()) if (c2.has(k)) fn(k)
  }
}

interface QueryTools extends QueryOps<Set<any>, any> {
  filterTxn(txn: I.Txn, query: I.KVQuery): I.Txn | null,
}

const eachTxnMatching = (txn: I.Txn, query: I.KVQuery, fn: (k: I.Key, op: I.Op) => void) => {
  eachIntersect<I.Key>(txn, query, k => fn(k, <I.Op>txn.get(k)))
}

const queryTools: {[name: string]: QueryTools} = {
  kv: {
    filterTxn(txn: I.Txn, query: I.KVQuery): I.Txn | null {
      let result: I.Txn | null = null
      eachIntersect<I.Key>(txn, query, k => {
        if (result == null) result = new Map<I.Key, I.Op>()
        result.set(k, <I.Op>txn.get(k))
      })
      return result
    },

    ...queryops.kv
  }
}

// Merge op into txn.
function mergeTxnInline(txn: I.Txn, other: I.Txn): boolean {
  for (const [k, op] of other) {
    const orig = txn.get(k)
    if (orig == null) txn.set(k, op)
    else {
      txn.set(k, fieldType.compose(orig, op))
    }
  }
  return other.size > 0
}

function catchupFnForStore(store: I.SCSource): I.CatchupFn {
  if (store.catchup) return store.catchup
  return (qtype, query, opts, callback) => {
    store.fetch(qtype, query, opts, (err, r) => {
      if (err) return callback(err)
      const {queryRun, results, versions} = <I.FetchResults>r

      const txn = new Map<I.Key, I.Op>()
      for (const [k, snapshot] of results) {
        txn.set(k, (snapshot === null) ? {type: 'rm'} : {type: 'set', data: snapshot})
      }
      callback(null, {txn, queryRun, versions})
    })
  }
}

export default class SubGroup {
  private readonly allSubs = new Set<Sub>()
  private readonly catchup: I.CatchupFn

  constructor(capabilities: any, store: I.SCSource) {
    this.catchup = catchupFnForStore(store)
  }

  onOp(source: I.Source, version: I.Version, txn: I.Txn) {
    for (const sub of this.allSubs) sub._onOp(source, version, txn)
  }

  create(qtype: I.QueryType, query: any, opts: any, listener: I.Listener): I.Subscription {
    const self = this

    const qops = queryTools[qtype]
    assert(qops)

    // The state of the subscription is
    // - the set of keys which the client knows about and
    // - the set of keys it *wants* to know about.
    let activeQuery = qops.create()
    // We'll store the range for which the active query result set is valid.
    // TODO: This is a lot of bookkeeping for individually keyed documents.
    const activeVersions: I.FullVersionRange = {}

    let pendingQuery = qops.create(query)
    type BufferItem = {
      source: I.Source, version: I.Version, txn: I.Txn
    }
    let opsBuffer: BufferItem[] | null = null

    // This is the subset of pendingQuery that we already know about.
    let knownDocs = opts.knownDocs
      ? qops.intersectDocs(opts.knownDocs, pendingQuery)
      : qops.create()

    let knownAtV: I.FullVersion = opts.knownAtVersions || {}

    // let waitingFetch = false

    const sub: Sub = {
      // cancelled: false,
      _onOp(source, version, txn) {
        console.log('2')
        if (opsBuffer) {
          const pendingTxn = qops.filterTxn(txn, pendingQuery)
          if (pendingTxn) opsBuffer.push({source, version, txn: pendingTxn})
        }

        const activeTxn = qops.filterTxn(txn, activeQuery)
        // console.log(activeQuery, activeTxn)
        if (activeTxn != null) {
          activeVersions[source] = {from: version, to: version}
          listener('txn', txn, activeVersions, this)
        } else {
          // Extend the known upper bound of the range anyway.
          if (activeVersions[source]) {
            activeVersions[source].to = version
            if (opts.alwaysNotify) listener('txn', null, activeVersions, this)
          }
        }
      },

      cursorNext(opts, callback) {
        if (qops.isEmpty(pendingQuery)) return callback()

        if (opsBuffer != null) return callback(Error('Already fetching'))

        opsBuffer = []

        let query, fromV
        if (qops.isEmpty(knownDocs)) {
          query = pendingQuery
          fromV = null // We have no knowledge.
        } else {
          query = knownDocs
          fromV = knownAtV
        }

        console.log('qq', query, pendingQuery, knownDocs, qops.isNoop(knownDocs))
        self.catchup(qtype, query, {
          knownAtVersions: fromV,
          limitDocs: opts.limitDocs,
          limitBytes: opts.limitBytes,
        }, (err, result) => {
          if (err) {
            opsBuffer = null
            return callback(err)
          }

          const {txn, queryRun, versions: resultVersions} = <I.CatchupResults>result

          // Things we need to do here:
          // - Update the returned snapshots based on opsBuffer
          // - Move the query run to the working result set
          // - Update activeQuery, pendingQuery and activeVersions.
          // - Emit returned data via listener

          ;(<BufferItem[]>opsBuffer).forEach(({source, version, txn: opTxn}) => {
            const resultV = resultVersions[source]
            if (resultV == null || resultV.to >= version) return

            mergeTxnInline(txn, opTxn)
            resultVersions[source] = {from:version, to:version}
          })
          opsBuffer = null

          pendingQuery = qops.apply(activeQuery, qops.asRemoveOp(queryRun))
          if (opts.knownDocs) knownDocs = qops.intersectDocs(knownDocs, pendingQuery)
          activeQuery = qops.apply(activeQuery, qops.asAddOp(queryRun))

          // resultVersions should just contain the versions that have changed,
          // so I think this is correct O_o
          for (const source in resultVersions) {
            activeVersions[source] = resultVersions[source]
          }

          listener('txn', txn, activeVersions, this)

          callback(null, {
            activeQuery,
            activeVersions,
          })
        })
      },

      isComplete() {
        return qops.isEmpty(pendingQuery)
      },

      cancel() {
        // this.cancelled = true
        self.allSubs.delete(this)
      }
    }
    this.allSubs.add(sub)
    return sub
  }

}

