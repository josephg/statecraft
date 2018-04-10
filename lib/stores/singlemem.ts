// This is a simple single value in-memory store.
import * as I from '../types/interfaces'
import fieldType from '../types/fieldops'
import genSource from '../gensource'
import err from '../err'

const capabilities = {
  queryTypes: new Set<I.QueryType>(['single']),
  mutationTypes: new Set<I.ResultType>(['single']),
  // ops: <I.OpsSupport>'none',
}

const singleStore = (initialValue: any = null, source: I.Source = genSource(), initialVersion: I.Version = 0): I.SimpleStore => {
  let version: number = initialVersion
  let data = initialValue

  const store: I.SimpleStore = {
    storeInfo: {
      capabilities,
      sources: [source]
    },
    fetch(query, opts) {
      if (query.type !== 'single') return Promise.reject(new err.UnsupportedTypeError())

      return Promise.resolve({
        results: data,
        queryRun: query,
        versions: {[source]: {from:version, to:version}},
      })
    },

    mutate(type, txn, versions, opts) {
      if (type !== 'single') return Promise.reject(new err.UnsupportedTypeError())
      const op = txn as I.Op

      const expectv = versions && versions[source]
      if (expectv != null && expectv < version) return Promise.reject(new err.VersionTooOldError())

      if (op) data = fieldType.apply(data, op)
      const opv = ++version

      store.onTxn && store.onTxn(source, opv - 1, opv, type, op)
      return Promise.resolve({[source]: opv})
    },

    close() {},
  }

  return store
}

export default singleStore
