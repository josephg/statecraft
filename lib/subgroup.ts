import * as I from './types/interfaces'
import queryops from './types/queryops'
import fieldOps from './types/fieldops'
import {QueryOps} from './types/type'
import {supportedTypes as localTypes} from './types/registry'
import {genCursorAll} from './util'

import assert = require('assert')

interface Sub extends I.Subscription {
  _onOp(source: I.Source, version: I.Version, type: I.ResultType, txn: I.Txn): void
  [prop: string]: any
}

/* There's a few strategies we could use here to catch up:
 * - Re-fetch all the documents and return a new image. If known versions is
 *   null, we have to do this.
 * - Get historical operations and do catchup. If noFetch is true, we have to
 *   do this. (And error if bestEffort is false).
 */
function catchupFnForStore(store: I.SimpleStore, getOps: I.GetOpsFn): I.CatchupFn {
  if (store.catchup) return store.catchup

  const runFetch = (qtype: I.QueryType, query: any, opts: I.CatchupOpts, callback: I.Callback<I.CatchupResults>) => {
    store.fetch(qtype, query, {}, (err, r) => {
      if (err) return callback(err)
      const {queryRun, results, versions} = r!

      const txn = queryops[qtype].r.asOp(results)
      callback(null, {type:'aggregate', queryRun, versions, txn})
    })
  }

  const runGetOps = (qtype: I.QueryType, query: any, opts: I.CatchupOpts, callback: I.Callback<I.CatchupResults>) => {
    const versions: I.FullVersionRange = {_other: {from:0, to: -1}}
    const {knownAtVersions} = opts
    if (knownAtVersions) for (const source in knownAtVersions) {
      versions[source] = {from:knownAtVersions[source], to: -1}
    }
    getOps(qtype, query, versions, {bestEffort: opts.bestEffort}, (err, r) => {
      if (err) return callback(err)
      const {ops, versions} = r!
      callback(null, {type: 'txns', queryRun: query, versions, txns: ops})
    })
  }

  return (qtype, query, opts, callback) => {
    // This is pretty sparse right now. It might make sense to be a bit fancier
    // and call getOps after fetching or something like that.
    if (opts.noAggregation) {
      runGetOps(qtype, query, opts, callback)
    } else {
      runFetch(qtype, query, opts, callback)
    }
  }
}

export default class SubGroup {
  private readonly allSubs = new Set<Sub>()
  private readonly catchup: I.CatchupFn

  constructor(store: I.SimpleStore, getOps: I.GetOpsFn = store.getOps!) {
    this.catchup = catchupFnForStore(store, getOps)
  }

  onOp(source: I.Source, fromV: I.Version, toV: I.Version, type: I.ResultType, txn: I.Txn) {
    for (const sub of this.allSubs) sub._onOp(source, toV, type, txn)
  }

  create(qtype: I.QueryType, query: any, opts: I.SubscribeOpts, listener: I.SubListener): I.Subscription {
    const self = this

    const qops = queryops[qtype]
    assert(qops)

    // TODO: Unused for now.
    const supportedTypes = opts.supportedTypes || localTypes
    const raw = opts.raw || false
    const noAggregation = opts.noAggregation || false
    const bestEffort = opts.bestEffort || false

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

    const catchup = (query: any, catchupOpts: I.CatchupOpts, callback: I.Callback<I.CatchupResults>) => {
      if (opts.noCatchup) return callback(null, null)
      return self.catchup(qtype, query, catchupOpts, callback)
    }

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
          // Its pretty awkward sending just a single item in an array like this.
          listener({type: 'txns', txns:[
            {versions: {[source]:version}, txn:activeTxn}
          ]}, activeVersions, this)
        } else {
          // Extend the known upper bound of the range anyway.
          if (activeVersions[source]) {
            activeVersions[source].to = version
            // TODO: Its more correct to create an empty transaction object here and put it in the list.
            // Sorry future me!
            if (opts.alwaysNotify) listener({type: 'txns', txns:[]}, activeVersions, this)
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
        catchup(query, {
          supportedTypes,
          raw,
          noAggregation,
          bestEffort,
          knownAtVersions: fromV,
          limitDocs: opts.limitDocs,
          limitBytes: opts.limitBytes,
        }, (err, _result) => {
          if (err) {
            opsBuffer = null
            return callback(err)
          }

          // Things we need to do here:
          // - Update the returned snapshots based on opsBuffer
          // - Move the query run to the working result set
          // - Update activeQuery, pendingQuery and activeVersions.
          // - Emit returned data via listener

          const result = _result!
          const {queryRun, versions: resultVersions} = result
          // const {txn, queryRun, versions: resultVersions} = result

          opsBuffer!.forEach(({source, version, txn: opTxn}) => {
            const resultV = resultVersions[source]
            if (resultV == null || version <= resultV.to) return

            if (result.type === 'txns') {
              result.txns.push({versions: {[source]: version}, txn: opTxn})
            } else {
              qops.r.composeMut!(result.txn, opTxn)
            }
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

          if (result.type === 'txns') {
            listener({type: 'txns', txns: result.txns}, activeVersions, this)
          } else {
            listener({type: 'aggregate', txn: result.txn, versions: resultVersions}, activeVersions, this)
          }

          callback(null, {
            activeQuery,
            activeVersions,
          })
        })
      },

      isComplete() {
        return qops.q.isEmpty(pendingQuery)
      },

      cursorAll() {},

      cancel() {
        // this.cancelled = true
        self.allSubs.delete(this)
      }
    }

    sub.cursorAll = genCursorAll(sub)

    this.allSubs.add(sub)
    return sub
  }

}

