import * as I from '../types/interfaces'

// This store simply sends all reads to one store, and all writes to another.
export default function splitWrites(readStore: I.Store, writeStore: I.Store): I.Store {
  return {
    storeInfo: {
      sources: readStore.storeInfo.sources,
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
