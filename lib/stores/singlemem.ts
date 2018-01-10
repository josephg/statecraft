// This is a simple single value in-memory store.
import * as I from '../types/interfaces'
import fieldType from '../types/fieldops'
import {genSource} from '../util'
import * as err from '../err'

const capabilities = {
  queryTypes: new Set<I.QueryType>(['single']),
  mutationTypes: new Set<I.ResultType>(['single']),
  // ops: <I.OpsSupport>'none',
}

const singleStore = (initialValue: any = null, source: I.Source = genSource(), initialVersion: I.Version = 0): I.SimpleStore => {
  let version: number = initialVersion
  let data = initialValue

  const store: I.SimpleStore = {
    capabilities,
    sources: [source],
    fetch(qtype, query, opts, callback) {
      if (qtype !== 'single') return callback(new err.UnsupportedTypeError())

      callback(null, {
        results: data,
        queryRun: query,
        versions: {[source]: {from:version, to:version}},
      })
    },

    mutate(type, txn, versions, opts, callback) {
      if (type !== 'single') return callback(new err.UnsupportedTypeError())
      const op = txn as I.Op

      const expectv = versions[source]
      if (expectv != null && expectv < version) return callback(new err.VersionTooOldError())

      if (op) data = fieldType.apply(data, op)
      const opv = ++version

      store.onTxn && store.onTxn(source, opv - 1, opv, type, op)
      callback(null, {[source]: opv})
    },

    close() {},
  }

  return store
}

export default singleStore
