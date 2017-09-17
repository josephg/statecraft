// This is a simple single value in-memory store.
import * as I from '../types/interfaces'
import SubGroup from '../subgroup'
import fieldType from '../types/fieldops'
import {genSource} from '../util'
import * as err from '../err'

const capabilities = {
  queryTypes: new Set<I.QueryType>(['single']),
  mutationTypes: new Set<I.ResultType>(['single']),
  ops: <I.OpsSupport>'none',
}

const singleStore = (initialValue: any = null, source: I.Source = genSource(), initialVersion: I.Version = 0) => {
  let version: number = initialVersion
  let data = initialValue

  let subscriptions: SubGroup | null = null

  const store: I.Store = {
    capabilities,
    fetch(qtype, query, opts, callback) {
      if (qtype !== 'single') return callback(new err.UnsupportedTypeError())

      callback(undefined, {
        results: data,
        queryRun: query,
        versions: {[source]: {from:version, to:version}},
      })
    },

    subscribe(qtype, query, opts, listener) {
      return subscriptions!.create(qtype, query, opts, listener)
    },

    mutate(type, op: I.Op, versions, opts, callback) {
      if (type !== 'single') return callback(new err.UnsupportedTypeError())

      const expectv = versions[source]
      if (expectv != null && expectv < version) return callback(new err.VersionTooOldError())

      if (op) data = fieldType.apply(data, op)
      const opv = ++version
      subscriptions!.onOp(source, opv, 'single', op)
      callback(null, {[source]: opv})
    }
  }
  subscriptions = new SubGroup(store)

  return store
}

export default singleStore
