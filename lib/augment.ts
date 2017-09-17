// This module turns a simple store into a real, usable store.
import * as I from './types/interfaces'

import makeOpCache from './opcache'
import SubGroup from './subgroup'

const augment = (innerStore: I.SimpleStore, opts?: any): I.Store => {
  const opcache = innerStore.getOps ? null : makeOpCache({})
  const getOps = innerStore.getOps || opcache!.getOps

  const subscriptions = innerStore.subscribe ? null : new SubGroup(innerStore, getOps)

  innerStore.onTxn = (source, fromV, toV, type, txn) => {
    opcache && opcache.onOp(source, fromV, toV, type, txn)
    subscriptions && subscriptions.onOp(source, fromV, toV, type, txn)
  }
  const outerStore: I.Store = {
    capabilities: innerStore.capabilities,
    source: innerStore.source,
    fetch: innerStore.fetch.bind(innerStore),
    // catchup: innerStore.catchup ? innerStore.catchup.bind(innerStore) : undefined,
    mutate: innerStore.mutate.bind(innerStore),
    close: innerStore.close ? innerStore.close.bind(innerStore) : undefined,

    getOps: getOps,
    subscribe: innerStore.subscribe || subscriptions!.create.bind(subscriptions)
  }

  return outerStore
}

export default augment
