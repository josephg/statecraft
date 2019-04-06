// This is a simple store that re-exposes a single key from the underlying
// store as a single value.

import * as I from '../interfaces'
import err from '../err'
import { bitSet, bitHas } from '../bit';

const capabilities = {
  queryTypes: bitSet(I.QueryType.Single),
  mutationTypes: bitSet(I.ResultType.Single),
  // ops: <I.OpsSupport>'none',
}

const onekey = <Val>(innerStore: I.Store<Val>, key: I.Key): I.Store<Val> => {
  const canMutate = bitHas(innerStore.storeInfo.capabilities.mutationTypes, I.ResultType.KV)
  // console.log('cm', canMutate, innerStore.storeInfo)

  const innerQuery: I.Query = {type: I.QueryType.KV, q: new Set([key])}
  if (!bitHas(innerStore.storeInfo.capabilities.queryTypes, I.QueryType.KV)) throw new err.UnsupportedTypeError('Inner store must support KV queries')

  const unwrapTxns = (txns: I.TxnWithMeta<Val>[]): I.TxnWithMeta<Val>[] => (
    txns.map(txn => {
      if(!(txn.txn instanceof Map)) throw new err.InvalidDataError()
      return {
        ...txn,
        txn: txn.txn.get(key),
      } as I.TxnWithMeta<Val>
    })
  )

  const unwrapCatchupData = (data: I.CatchupData<Val>): I.CatchupData<Val> => {
    let hasReplace = false
    if (data.replace) {
      const replaceQ = data.replace.q
      if (replaceQ.type !== I.QueryType.KV) throw new err.InvalidDataError()
      if (replaceQ.q.has(key)) hasReplace = true
    }

    return {
      ...data,
      replace: hasReplace ? {
        q: {type: I.QueryType.Single, q: true},
        with: data.replace!.with.get(key),
        versions: data.replace!.versions,
      } : undefined,
      txns: unwrapTxns(data.txns),
    }
  }

  return {
    storeInfo: {
      uid: `onekey(${innerStore.storeInfo.uid},${key})`,
      sources: innerStore.storeInfo.sources,
      capabilities: {
        mutationTypes: canMutate ? capabilities.mutationTypes : new Set(),
        ...capabilities,
      }
    },

    async fetch(query, opts) {
      if (query.type !== I.QueryType.Single) throw new err.UnsupportedTypeError()

      const results = await innerStore.fetch(innerQuery, opts)
      // if (results.type !== 'kv') throw new err.InvalidDataError()

      return {
        results: results.results.get(key),
        queryRun: query,
        versions: results.versions,
      }
    },

    async mutate(type, txn, versions, opts = {}) {
      if (!canMutate) throw new err.UnsupportedTypeError('Underlying store is read only')
      if (type !== I.ResultType.Single) throw new err.UnsupportedTypeError()

      const innerTxn = new Map([[key, txn as I.Op<Val>]])
      return await innerStore.mutate(I.ResultType.KV, innerTxn, versions, {
        ...opts,
        // conflictKeys: opts.conflictKeys && opts.conflictKeys.includes(key) ? [''] : undefined,
      })
    },

    // Should probably pass a parameter on whether we take ownership of the underlying store or not.
    close() { innerStore.close() },

    async getOps(query, reqVersions, opts) {
      if (query.type !== I.QueryType.Single) throw new err.UnsupportedTypeError()

      const {ops, versions} = await innerStore.getOps(innerQuery, reqVersions, opts)

      // Just going to mutate the ops in place.
      
      return {
        ops: unwrapTxns(ops),
        versions,
      }
    },

    catchup: innerStore.catchup ? async (query, fromVersion, opts) => (
      unwrapCatchupData(await innerStore.catchup!(innerQuery, fromVersion, opts))
    ) : undefined,

    // TODO: Map catchup if it exists in the underlying store.

    subscribe(query, opts = {}) {
      if (query.type !== I.QueryType.Single) throw new err.UnsupportedTypeError()

      const innerSub = innerStore.subscribe(innerQuery, opts)

      // TODO: It'd be great to have a SubscriptionMap thing that lets you map
      // the resulting data you get back from a subscription. That'd be useful
      // in a few places and this is really wordy.
      return (async function*() {
        for await (const innerUpdates of innerSub) {
          yield unwrapCatchupData(innerUpdates)
        }
        // TODO: Does this pass through return() correctly?
      })() as I.AsyncIterableIteratorWithRet<I.CatchupData<Val>>
    },

  }
}

export default onekey