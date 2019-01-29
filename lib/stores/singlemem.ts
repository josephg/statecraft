// This is a simple single value in-memory store.
import * as I from '../interfaces'
import fieldOps from '../types/field'
import genSource from '../gensource'
import err from '../err'
import {V64, vCmp} from '../version'

const capabilities = {
  queryTypes: new Set<I.QueryType>(['single']),
  mutationTypes: new Set<I.ResultType>(['single']),
  // ops: <I.OpsSupport>'none',
}

const singleStore = (initialValue: any = null, source: I.Source = genSource(), initialVersionNum: number = 0): I.SimpleStore => {
  let version: number = initialVersionNum
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
        versions: {[source]: {from:V64(version), to:V64(version)}},
      }
    },

    async mutate(type, txn, versions, opts = {}) {
      if (type !== 'single') throw new err.UnsupportedTypeError()
      const op = txn as I.Op

      const expectv = versions && versions[source]
      const currentv = V64(version)
      if (expectv != null && vCmp(expectv, currentv) < 0) throw new err.VersionTooOldError()

      if (op) data = fieldOps.apply(data, op)
      const newv = V64(++version)

      store.onTxn && store.onTxn(source, currentv, newv, type, op, data, opts.meta || {})
      return {[source]: newv}
    },

    close() {},
  }

  return store
}

export function setSingle(store: I.SimpleStore, value: any) {
  return store.mutate('single', {type: 'set', data: value})
}

export default singleStore
