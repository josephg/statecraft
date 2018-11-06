import * as I from './types/interfaces'
import {queryTypes, wrapQuery, getQueryData} from './types/queryops'
import fieldOps from './types/fieldops'
import {QueryOps} from './types/type'
import {supportedTypes as localTypes} from './types/registry'
// import {genCursorAll} from './util'
import streamToIter from './streamToIter'

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

  const runFetch: I.CatchupFn = async (query, opts) => {
    const {queryRun, results, versions} = await store.fetch(query, {})
    
    return {
      resultingVersions: versions,
      replace: {q: queryRun, with: results},
      txns: []
    }
  }

  const runGetOps: I.CatchupFn = async (query, opts) => {
    const versions: I.FullVersionRange = {_other: {from:0, to: -1}}

    const knownAtVersions = opts.knownAtVersions
    if (knownAtVersions) for (const source in knownAtVersions) {
      versions[source] = {from:knownAtVersions[source], to: -1}
    }

    const {ops, versions: opVersions} = await getOps(query, versions, {bestEffort: opts.bestEffort})
    return {
      resultingVersions: opVersions,
      // queryChange: query,
      txns: ops,
    }
  }

  return (query, opts) => {
    // console.log('running catchup', query, opts)
    // This is pretty sparse right now. It might make sense to be a bit fancier
    // and call getOps after fetching or something like that.
    return (opts && opts.noAggregation) ? runGetOps(query, opts) : runFetch(query, opts)
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

  create(query: I.Query, opts: I.SubscribeOpts): I.Subscription {
    const self = this

    const qtype = query.type
    const qops = queryTypes[qtype]
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
    //
    // Note that the range starts completely open - the results for an empty
    // query are valid everywhere.
    const activeVersions: I.FullVersionRange = {}

    let pendingQuery = qops.q.create(getQueryData(query))
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

    if (opts.noCatchup) {
      throw Error('Not implemented')
      // Something like this...
      // [activeQuery, pendingQuery] = [pendingQuery, activeQuery]
    }

    let sub: Sub

    const stream = streamToIter<I.CatchupData>(() => {
      self.allSubs.delete(sub)
    })

    // let waitingFetch = false

    sub = {
      // cancelled: false,
      _onOp(source, version, type, intxn) {
        const txn = qops.r.name === type ? intxn : qops.r.from(type, intxn)

        if (opsBuffer) {
          const pendingTxn = qops.filterTxn(txn, pendingQuery)
          if (pendingTxn) opsBuffer.push({source, version, txn: pendingTxn})
        }

        // TODO: Apply supportedTypes.
        const activeTxn = qops.filterTxn(txn, activeQuery)

        // Extend the known upper bound of the range no matter what.
        let av = activeVersions[source]
        if (av) av.to = version // null av = valid for whole source range.

        // console.log(activeQuery, activeTxn)
        if (opts.alwaysNotify || activeTxn != null) {
          if (activeTxn != null) {
            if (av == null) {
              av = {from: version, to: version}
              activeVersions[source] = av
            } else av.from = version
          }

          // Its pretty awkward sending just a single item in an array like this.
          // console.log('stream append')
          stream.append({
            resultingVersions: activeVersions,
            txns:[
              {versions: {[source]:version}, txn:activeTxn}
            ]
          })
        }
      },

      async cursorNext(opts = {}) {
        // console.log('pqe', pendingQuery, qops.q.isEmpty(pendingQuery))
        if (qops.q.isEmpty(pendingQuery)) return Promise.resolve({
          activeQuery: wrapQuery(qtype, activeQuery),
          activeVersions,
        })

        if (opsBuffer != null) return Promise.reject(Error('Already fetching'))

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
        const result = await self.catchup(wrapQuery(qtype, query), {
          supportedTypes,
          raw,
          noAggregation,
          bestEffort,
          knownAtVersions: fromV,
          limitDocs: opts.limitDocs,
          limitBytes: opts.limitBytes,
        }).catch(err => {
          opsBuffer = null
          throw err
        })

        const {replace, resultingVersions} = result

        // Things we need to do here:
        // - Update the returned snapshots based on opsBuffer
        // - Move the query run to the working result set
        // - Update activeQuery, pendingQuery and activeVersions.
        // - Emit returned data via listener

        opsBuffer!.forEach(({source, version, txn: opTxn}) => {
          const resultV = resultingVersions[source]
          if (resultV == null || version <= resultV.to) return

          result.txns.push({versions: {[source]: version}, txn: opTxn})
          resultingVersions[source] = {from:version, to:version}
        })

        opsBuffer = null

        if (replace != null) {
          pendingQuery = qops.q.subtract(activeQuery, getQueryData(replace.q))
          if (opts.knownDocs) knownDocs = qops.q.intersectDocs(knownDocs, pendingQuery)
          activeQuery = qops.q.add(activeQuery, getQueryData(replace.q))
        }

        // resultingVersions should just contain the versions that have changed,
        // so I think this is correct O_o
        for (const source in resultingVersions) {
          activeVersions[source] = resultingVersions[source]
        }

        stream.append(result)

        return({
          activeQuery: wrapQuery(qtype, activeQuery),
          activeVersions,
        })
      },

      async cursorAll(opts) {
        while (true) {
          const result = await this.cursorNext(opts)
          if (this.isComplete()) return result
        }
      },

      isComplete() {
        return qops.q.isEmpty(pendingQuery)
      },

      // cursorAll: null as any,

      iter: stream.iter,

      [Symbol.asyncIterator]() { return stream.iter }
    }

    // sub.cursorAll = genCursorAll(sub)

    this.allSubs.add(sub)
    return sub
  }

}

