// This module turns a simple store into a real, usable store.
import * as I from './types/interfaces'

import makeOpCache from './opcache'
import SubGroup from './subgroup'

const augment = (innerStore: I.SimpleStore, opts?: any): I.Store => {
  const opcache = innerStore.getOps ? null : makeOpCache({})
  const getOps = innerStore.getOps || opcache!.getOps

  const subscriptions = innerStore.subscribe ? null : new SubGroup(innerStore, getOps)

  innerStore.onTxn = (source, fromV, toV, type, txn, meta) => {
    opcache && opcache.onOp(source, fromV, toV, type, txn, meta)
    subscriptions && subscriptions.onOp(source, fromV, toV, type, txn, meta)
  }
  const outerStore: I.Store = {
    storeInfo: innerStore.storeInfo,
    fetch: innerStore.fetch.bind(innerStore),
    catchup: innerStore.catchup ? innerStore.catchup.bind(innerStore) : undefined,
    mutate: innerStore.mutate.bind(innerStore),
    close: innerStore.close ? innerStore.close.bind(innerStore) : undefined,

    getOps: getOps,
    subscribe: innerStore.subscribe || subscriptions!.create.bind(subscriptions)
  }

  if (innerStore.storeInfo.capabilities.mutationTypes.has('resultmap')) {
    outerStore.set = (key: I.Key, val: I.Val) => {
      const txn = new Map([[key, {type:'set', data: val}]])
      return innerStore.mutate('resultmap', txn, {}, {})
    }
  }

  return outerStore
}

export default augment
