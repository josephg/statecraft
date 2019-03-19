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

const singleStore = <Val = any>(initialValue: Val, source: I.Source = genSource(), initialVersionNum: number = 0): I.SimpleStore<Val> => {
  let version: number = initialVersionNum
  let data = initialValue

  const store: I.SimpleStore<Val> = {
    storeInfo: {
      uid: `single(${source})`,
      capabilities,
      sources: [source]
    },
    async fetch(query, opts) {
      if (query.type !== 'single') throw new err.UnsupportedTypeError()

      return {
        results: data,
        queryRun: query,
        versions: [{from:V64(version), to:V64(version)}],
      }
    },

    async mutate(type, txn, versions, opts = {}) {
      if (type !== 'single') throw new err.UnsupportedTypeError()
      const op = txn as I.Op<Val>

      const expectv = versions && versions[0]
      const currentv = V64(version)
      if (expectv != null && vCmp(expectv, currentv) < 0) throw new err.VersionTooOldError()

      if (op) data = fieldOps.apply(data, op)
      const newv = V64(++version)

      store.onTxn && store.onTxn(source, currentv, newv, type, op, opts.meta || {})
      return [newv]
    },

    close() {},
  }

  return store
}

export function setSingle<Val>(store: I.SimpleStore<Val>, value: Val) {
  return store.mutate('single', {type: 'set', data: value})
}

export default singleStore
