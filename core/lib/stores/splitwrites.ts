import * as I from '../interfaces'

// This store simply sends all reads to one store, and all writes to another.
export default function splitWrites<Val>(readStore: I.Store<Val>, writeStore: I.Store<Val>): I.Store<Val> {
  return {
    storeInfo: {
      uid: readStore.storeInfo.uid, // TODO: Is this ok?
      sources: readStore.storeInfo.sources,
      sourceIsMonotonic: readStore.storeInfo.sourceIsMonotonic,
      capabilities: {
        queryTypes: readStore.storeInfo.capabilities.queryTypes,
        mutationTypes: writeStore.storeInfo.capabilities.mutationTypes,
      }
    },

    fetch: readStore.fetch,
    catchup: readStore.catchup,
    getOps: readStore.getOps,
    subscribe: readStore.subscribe,

    mutate: writeStore.mutate,

    close() {
      readStore.close()
      writeStore.close()
    },
  }
}
