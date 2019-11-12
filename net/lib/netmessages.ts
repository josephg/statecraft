import {I, ErrJson} from '@statecraft/core'

export type Ref = /*string |*/ number

export type NetKVTxn = [I.Key, I.Op<any>][]
export type NetTxn = I.SingleTxn<any> | NetKVTxn

export type NetQuery = I.QueryType.Single | I.QueryType.AllKV | [I.QueryType, any]

export type NetVersion = number[] // This makes me really sad. Not needed with msgpack; only for json.
export type NetVersionRange = [NetVersion, NetVersion]
export type NetFullVersion = (null | NetVersion)[]
export type NetFullVersionRange = (null | NetVersionRange)[]

export type SubscribeOpts = {
  // TODO: Add all the rest!!!
  st?: string[]
  fv?: NetFullVersion | 'c', // known at versions
}

export const enum Action {
  // Many of these are used by both the server and client.
  Hello = 0,
  Err = 1,
  
  Fetch = 2,
  GetOps = 3,
  Mutate = 4,
  SubCreate = 5,
  SubClose = 6,
  SubUpdate = 7,
}

// **************** Client -> Server messages

export interface FetchRequest {
  a: Action.Fetch,
  ref: Ref,
  query: NetQuery,
  opts: I.FetchOpts,
}

export interface GetOpsRequest {
  a: Action.GetOps,
  ref: Ref,
  query: NetQuery,
  v: NetFullVersionRange,
  opts: I.GetOpsOptions,
}

export interface MutateRequest {
  a: Action.Mutate,
  ref: Ref,
  mtype: I.ResultType,
  txn: any,
  v: NetFullVersion,
  opts: I.MutateOptions,
}

export interface SubCreate {
  a: Action.SubCreate,
  ref: Ref,
  query: NetQuery,
  opts: SubscribeOpts
}

export interface SubClose {
  a: Action.SubClose,
  ref: Ref, // Ref of subscription
}

export type CSMsg =
  FetchRequest
  | MutateRequest
  | GetOpsRequest
  | SubCreate
  | SubClose


// **************** Server -> Client messages

export interface HelloMsg {
  a: Action.Hello,
  p: 'statecraft',
  pv: number,
  uid: string,
  sources: I.Source[], // ??? TODO: Still not sure whether to allow unknown sources.
  m: boolean[], // This is kinda wasteful over the wire, but probably not a big deal. Bitvector would be better.
  capabilities: number[]
}

export interface FetchResponse {
  a: Action.Fetch,
  ref: Ref,
  results: any, // Dependant on query.

  bakedQuery?: NetQuery,
  versions: NetFullVersionRange, // Range across which version is valid.
}

// txn, version, meta.
export type NetTxnWithMeta = [any, NetFullVersion, any]

export interface GetOpsResponse {
  a: Action.GetOps,
  ref: Ref,
  ops: NetTxnWithMeta[],
  v: NetFullVersionRange
}

export interface MutateResponse {
  a: Action.Mutate,
  ref: Ref,
  v: NetFullVersion,
}

export interface ResponseErr { // Used for fetch, mutate and getops
  a: Action.Err,
  ref: Ref,
  err: ErrJson,
}

export interface SubUpdate {
  a: Action.SubUpdate,
  ref: Ref,

  // Replace data. If r exists, q must exist too.
  q?: NetQuery, // active query diff
  r?: any, // replacement
  rv?: NetFullVersion,
  u: boolean,

  txns: NetTxnWithMeta[], // updates on top of replacement
  
  tv: NetFullVersion, // version diff
}

// The subscription has closed
export interface SubRet {
  a: Action.SubClose,
  ref: Ref,
}


export type SCMsg =
  HelloMsg
  | FetchResponse
  | GetOpsResponse
  | MutateResponse
  | ResponseErr
  | SubUpdate
  | SubRet

// export const flatten1 = (data: any) => (data instanceof Map || data instanceof Set) ? Array.from(data) : data
