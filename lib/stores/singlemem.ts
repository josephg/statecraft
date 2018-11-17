// This is a simple single value in-memory store.
import * as I from '../interfaces'
import fieldOps from '../types/field'
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
    async fetch(query, opts) {
      if (query.type !== 'single') throw new err.UnsupportedTypeError()

      return {
        results: data,
        queryRun: query,
        versions: {[source]: {from:version, to:version}},
      }
    },

    async mutate(type, txn, versions, opts = {}) {
      if (type !== 'single') throw new err.UnsupportedTypeError()
      const op = txn as I.Op

      const expectv = versions && versions[source]
      if (expectv != null && expectv < version) throw new err.VersionTooOldError()

      if (op) data = fieldOps.apply(data, op)
      const opv = ++version

      store.onTxn && store.onTxn(source, opv - 1, opv, type, op, data, opts.meta || {})
      return {[source]: opv}
    },

    close() {},
  }

  return store
}

export default singleStore
