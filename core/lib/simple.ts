// This contains some simple helpers to get / set values.
import * as I from './interfaces'

export const getKV = async <Val>(store: I.Store<Val>, k: I.Key): Promise<Val> => {
  const r = await store.fetch({type: I.QueryType.KV, q: new Set([k])})
  return r.results.get(k)
}

export const setKV = <Val>(store: I.Store<Val>, k: I.Key, v: Val): Promise<I.FullVersion> => (
  store.mutate(I.ResultType.KV, new Map([[k, {type: 'set', data: v}]]))
)

export const rmKV = <Val>(store: I.Store<Val>, k: I.Key): Promise<I.FullVersion> => (
  store.mutate(I.ResultType.KV, new Map([[k, {type: 'rm'}]]))
)

export const getSingle = async <Val>(store: I.Store<Val>) => (
  (await store.fetch({type: I.QueryType.Single, q:true})).results
)

export const setSingle = <Val>(store: I.Store<Val>, value: Val) => (
  store.mutate(I.ResultType.Single, {type: 'set', data: value})
)
