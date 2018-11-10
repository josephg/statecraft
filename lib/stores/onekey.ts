// This is a simple store that re-exposes a single key from the underlying
// store as a single value.

import * as I from '../types/interfaces'
import err from '../err'
import assert = require('assert')

const capabilities = {
  queryTypes: new Set<I.QueryType>(['single']),
  mutationTypes: new Set<I.ResultType>(['single']),
  // ops: <I.OpsSupport>'none',
}

const onekey = (innerStore: I.Store, key: I.Key): I.Store => {
  const canMutate = innerStore.storeInfo.capabilities.mutationTypes.has('resultmap')

  const innerQuery: I.Query = {type: 'kv', q: new Set([key])}
  if (!innerStore.storeInfo.capabilities.queryTypes.has('kv')) throw new err.UnsupportedTypeError('Inner store must support KV queries')

  const unwrapTxns = (txns: I.TxnWithMeta[]): I.TxnWithMeta[] => (
    txns.map(txn => {
      if(!(txn.txn instanceof Map)) throw new err.InvalidDataError()
      return {versions: txn.versions, txn: txn.txn.get(key)} as I.TxnWithMeta
    })
  )

  const unwrapCatchupData = (data: I.CatchupData): I.CatchupData => {
    let hasReplace = false
    if (data.replace) {
      const replaceQ = data.replace.q
      if (replaceQ.type !== 'kv') throw new err.InvalidDataError()
      if (replaceQ.q.has(key)) hasReplace = true
    }

    return {
      resultingVersions: data.resultingVersions,
      replace: hasReplace ? {
        q: {type: 'single', q: true},
        with: data.replace!.with.get(key),
      } : undefined,
      txns: unwrapTxns(data.txns),
    }
  }

  return {
    storeInfo: {
      sources: innerStore.sources,
      capabilities: {
        mutationTypes: canMutate ? capabilities.mutationTypes : new Set(),
        ...capabilities,
      }
    },

    async fetch(query, opts) {
      if (query.type !== 'single') throw new err.UnsupportedTypeError()

      const results = await innerStore.fetch(innerQuery, opts)
      // if (results.type !== 'resultmap') throw new err.InvalidDataError()

      return {
        results: results.results.get(key),
        queryRun: query,
        versions: results.versions,
      }
    },

    async mutate(type, txn, versions, opts = {}) {
      if (!canMutate) throw new err.UnsupportedTypeError('Underlying store is read only')
      if (type !== 'single') throw new err.UnsupportedTypeError()

      const innerTxn = new Map([[key, txn as I.Op]])
      return await innerStore.mutate('resultmap', innerTxn, versions, {
        conflictKeys: opts.conflictKeys && opts.conflictKeys.includes(key) ? [''] : undefined
      })
    },

    // Should probably pass a parameter on whether we take ownership of the underlying store or not.
    close() { innerStore.close() },

    async getOps(query, reqVersions, opts) {
      if (query.type !== 'single') throw new err.UnsupportedTypeError()

      const {ops, versions} = await innerStore.getOps(innerQuery, reqVersions, opts)

      // Just going to mutate the ops in place.
      
      return {
        ops: unwrapTxns(ops),
        versions,
      }
    },

    catchup: innerStore.catchup ? async (query, opts) => (
      unwrapCatchupData(await innerStore.catchup!(innerQuery, opts))
    ) : undefined,

    // TODO: Map catchup if it exists in the underlying store.

    subscribe(query, outerOps = {}) {
      if (query.type !== 'single') throw new err.UnsupportedTypeError()

      const opts = {...outerOps}
      if (opts.knownDocs) opts.knownDocs = new Set([key])
      const innerSub = innerStore.subscribe(innerQuery, opts)

      const unwrapResult = (result: I.SubCursorResult): I.SubCursorResult => {
        if (result.activeQuery.type !== 'kv') throw new err.InvalidDataError()
        return {
          ...result,
          activeQuery: {type: 'single', q: result.activeQuery.q.has(key)},
        }
      }

      const iter = (async function*() {
        for await (const innerUpdates of innerSub.iter) {
          yield unwrapCatchupData(innerUpdates)
        }
      })() as I.AsyncIterableIteratorWithRet<I.CatchupData>

      // TODO: It'd be great to have a SubscriptionMap thing that lets you map
      // the resulting data you get back from a subscription. That'd be useful
      // in a few places and this is really wordy.
      return {
        iter,
        [Symbol.asyncIterator]() { return iter },

        async cursorNext(opts) {
          return unwrapResult(await innerSub.cursorNext(opts))
        },
        async cursorAll(opts) {
          return unwrapResult(await innerSub.cursorAll(opts))
        },
        isComplete() { return innerSub.isComplete() },
      }

    },
  }
}

export default onekey