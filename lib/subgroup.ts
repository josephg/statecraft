import * as I from './types/interfaces'
import queryops from './types/queryops'
import fieldOps from './types/fieldops'
import {QueryOps} from './types/type'

import assert = require('assert')

interface Sub extends I.Subscription {
  _onOp(source: I.Source, version: I.Version, type: I.ResultType, txn: I.Txn): void
  [prop: string]: any
}

function catchupFnForStore(store: I.Store): I.CatchupFn {
  if (store.catchup) return store.catchup
  return (qtype, query, opts, callback) => {
    store.fetch(qtype, query, opts, (err, r) => {
      if (err) return callback(err)
      const {queryRun, results, versions} = r!

      const txn = queryops[qtype].r.asOp(results)
      callback(null, {txn, queryRun, versions})
    })
  }
}

export default class SubGroup {
  private readonly allSubs = new Set<Sub>()
  private readonly catchup: I.CatchupFn

  constructor(store: I.Store) {
    this.catchup = catchupFnForStore(store)
  }

  onOp(source: I.Source, version: I.Version, type: I.ResultType, txn: I.Txn) {
    for (const sub of this.allSubs) sub._onOp(source, version, type, txn)
  }

  create(qtype: I.QueryType, query: any, opts: any, listener: I.Listener): I.Subscription {
    const self = this

    const qops = queryops[qtype]
    assert(qops)

    // The state of the subscription is
    // - the set of keys which the client knows about and
    // - the set of keys it *wants* to know about.
    let activeQuery = qops.q.create()
    // We'll store the range for which the active query result set is valid.
    // TODO: This is a lot of bookkeeping for individually keyed documents.
    const activeVersions: I.FullVersionRange = {}

    let pendingQuery = qops.q.create(query)
    type BufferItem = {
      source: I.Source, version: I.Version, txn: I.Txn
    }
    let opsBuffer: BufferItem[] | null = null

    // This is the subset of pendingQuery that we already know about.
    // Its a query because thats how we express a subset of documents.
    let knownDocs = opts.knownDocs
      ? qops.q.intersectDocs(opts.knownDocs, pendingQuery)
      : qops.q.create()

    let knownAtV: I.FullVersion = opts.knownAtVersions || {}

    // let waitingFetch = false

    const sub: Sub = {
      // cancelled: false,
      _onOp(source, version, type, intxn) {
        const txn = qops.r.name === type ? intxn : qops.r.from(type, intxn)

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
        // console.log('pqe', pendingQuery, qops.q.isEmpty(pendingQuery))
        if (qops.q.isEmpty(pendingQuery)) return callback()

        if (opsBuffer != null) return callback(Error('Already fetching'))

        opsBuffer = []

        let query, fromV
        if (qops.q.isEmpty(knownDocs)) {
          query = pendingQuery
          fromV = null // We have no knowledge.
        } else {
          query = knownDocs
          fromV = knownAtV
        }

        // console.log('qq', query, pendingQuery, knownDocs, qops.q.isNoop(knownDocs))
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

            qops.r.composeMut!(txn, opTxn)
            resultVersions[source] = {from:version, to:version}
          })
          opsBuffer = null

          pendingQuery = qops.q.subtract(activeQuery, queryRun)
          if (opts.knownDocs) knownDocs = qops.q.intersectDocs(knownDocs, pendingQuery)
          activeQuery = qops.q.add(activeQuery, queryRun)

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
        return qops.q.isEmpty(pendingQuery)
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

