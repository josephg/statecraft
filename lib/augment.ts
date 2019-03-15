// This module turns a simple store into a real, usable store.
import * as I from './interfaces'

import makeOpCache from './opcache'
import SubGroup from './subgroup'

const augment = <Val>(innerStore: I.SimpleStore<Val>, opts?: any): I.Store<Val> => {
  const opcache = innerStore.getOps ? null : makeOpCache({
    sources: innerStore.storeInfo.sources
  })
  const getOps = innerStore.getOps || opcache!.getOps

  const subscriptions = innerStore.subscribe ? null : new SubGroup(innerStore, getOps)

  innerStore.onTxn = (source, fromV, toV, type, txn, view, meta) => {
    opcache && opcache.onOp(source, fromV, toV, type, txn, meta)
    subscriptions && subscriptions.onOp(source, fromV, toV, type, txn, view, meta)
  }
  const outerStore: I.Store<Val> = {
    storeInfo: innerStore.storeInfo,
    fetch: innerStore.fetch.bind(innerStore),
    catchup: innerStore.catchup ? innerStore.catchup.bind(innerStore) : undefined,
    mutate: innerStore.mutate.bind(innerStore),
    close: innerStore.close.bind(innerStore),

    getOps: getOps,
    subscribe: innerStore.subscribe || subscriptions!.create.bind(subscriptions)
  }

  if (innerStore.storeInfo.capabilities.mutationTypes.has('kv')) {
    outerStore.set = (key: I.Key, val: Val) => {
      const txn = new Map([[key, {type:'set', data: val}]])
      return innerStore.mutate('kv', txn)
    }
  }

  return outerStore
}

export default augment
