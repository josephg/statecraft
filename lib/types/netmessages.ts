import * as I from './interfaces'

export type Ref = string | number
export interface FetchRequest {
  a: 'fetch',
  ref: Ref,
  qtype: I.QueryType,
  query: any,
  opts: I.FetchOpts,
}

export interface Y {
  a: 'Yo'
}

export type CSMsg = FetchRequest | Y


export interface HelloMsg {
  a: 'hello',
  p: 'statecraft',
  pv: number,
  sources?: I.Source[], // ??? TODO: Still not sure whether to allow unknown sources.
  capabilities: any[]
}

export interface FetchResponseOk extends I.FetchResults {
  a: 'fetch',
  ref: Ref,
}

export interface FetchResponseErr {
  a: 'fetch',
  ref: Ref,
  error: string,
}

export type SCMsg = HelloMsg | FetchResponseOk | FetchResponseErr

export const flatten1 = (data: any) => (data instanceof Map || data instanceof Set) ? Array.from(data) : data
