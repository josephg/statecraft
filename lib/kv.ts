// This contains some simple helpers to get / set values.
import * as I from './interfaces'

export const getKV = async <Val>(store: I.SimpleStore<Val>, k: I.Key): Promise<Val> => {
  const r = await store.fetch({type: 'kv', q: new Set([k])})
  return r.results.get(k)
}

export const setKV = async <Val>(store: I.SimpleStore<Val>, k: I.Key, v: Val): Promise<I.FullVersion> => {
  return await store.mutate('kv', new Map([[k, {type: 'set', data: v}]]))
}

export const rmKV = async <Val>(store: I.SimpleStore<Val>, k: I.Key): Promise<I.FullVersion> => {
  return await store.mutate('kv', new Map([[k, {type: 'rm'}]]))
}
