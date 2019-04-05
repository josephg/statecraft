// This is a simple single value in-memory store.
import * as I from '../interfaces'
import fieldOps from '../types/field'
import genSource from '../gensource'
import err from '../err'
import {V64, vCmp} from '../version'
import {bitSet} from '../bit'
import streamToIter from '../streamToIter'
import SubGroup from '../subgroup'
import makeOpCache from '../opcache'

const capabilities = {
  queryTypes: bitSet(I.QueryType.Single),
  mutationTypes: bitSet(I.ResultType.Single),
  // ops: <I.OpsSupport>'none',
}

export default function singleStore<Val = any>(initialValue: Val, source: I.Source = genSource(), initialVersionNum: number = 0): I.Store<Val> {
  let version: number = initialVersionNum
  let data = initialValue

  const fetch: I.FetchFn<Val> = async (query, opts) => {
    if (query.type !== I.QueryType.Single) throw new err.UnsupportedTypeError()

    return {
      results: data,
      queryRun: query,
      versions: [{from:V64(version), to:V64(version)}],
    }
  }

  const opcache = makeOpCache<Val>()
  const subGroup = new SubGroup({initialVersion: [V64(version)], fetch, getOps: opcache.getOps})

  const store: I.Store<Val> = {
    storeInfo: {
      uid: `single(${source})`,
      capabilities,
      sources: [source]
    },
    
    fetch,
    getOps: opcache.getOps,

    subscribe: subGroup.create.bind(subGroup),

    async mutate(type, _txn, versions, opts = {}) {
      if (type !== I.ResultType.Single) throw new err.UnsupportedTypeError()
      const txn = _txn as I.Op<Val>

      const expectv = versions && versions[0]
      const currentv = V64(version)
      if (expectv != null && vCmp(expectv, currentv) < 0) throw new err.VersionTooOldError()

      if (txn) data = fieldOps.apply(data, txn)
      const newv = V64(++version)

      opcache.onOp(0, currentv, newv, I.ResultType.Single, txn, opts.meta || {})
      subGroup.onOp(0, currentv, [{txn, meta: opts.meta || {}, versions: [newv]}])
      return [newv]
    },

    close() {},
  }

  return store
}

export function setSingle<Val>(store: I.Store<Val>, value: Val) {
  return store.mutate(I.ResultType.Single, {type: 'set', data: value})
}
