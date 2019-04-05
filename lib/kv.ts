// This contains some simple helpers to get / set values.
import * as I from './interfaces'

export const getKV = async <Val>(store: I.Store<Val>, k: I.Key): Promise<Val> => {
  const r = await store.fetch({type: I.QueryType.KV, q: new Set([k])})
  return r.results.get(k)
}

export const setKV = async <Val>(store: I.Store<Val>, k: I.Key, v: Val): Promise<I.FullVersion> => {
  return await store.mutate(I.ResultType.KV, new Map([[k, {type: 'set', data: v}]]))
}

export const rmKV = async <Val>(store: I.Store<Val>, k: I.Key): Promise<I.FullVersion> => {
  return await store.mutate(I.ResultType.KV, new Map([[k, {type: 'rm'}]]))
}
