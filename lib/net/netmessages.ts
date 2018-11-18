import * as I from '../interfaces'
import {ErrJson} from '../err'

export type Ref = /*string |*/ number

export type NetKVTxn = [I.Key, I.Op][]
export type NetTxn = I.SingleTxn | NetKVTxn

export type NetQuery = 'single' | 'allkv' | [I.QueryType, any]

export type SubscribeOpts = {
  // TODO: Add all the rest!!!
  st?: string[]
  fv?: I.FullVersion | 'c', // known at versions
}

export const enum Action {
  // Many of these are used by both the server and client.
  Hello,
  Err,
  
  Fetch,
  GetOps,
  Mutate,
  SubCreate,
  SubClose,
  SubUpdate,
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
  v: I.FullVersionRange,
  opts: I.GetOpsOptions,
}

export interface MutateRequest {
  a: Action.Mutate,
  ref: Ref,
  mtype: I.ResultType,
  txn: any,
  v: I.FullVersion,
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
  sources: I.Source[], // ??? TODO: Still not sure whether to allow unknown sources.
  capabilities: any[]
}

export interface FetchResponse {
  a: Action.Fetch,
  ref: Ref,
  results: any, // Dependant on query.

  bakedQuery?: NetQuery,
  versions: I.FullVersionRange, // Range across which version is valid.
}

// txn, version, meta.
export type NetTxnWithMeta = [any, I.FullVersion, any]

export interface GetOpsResponse {
  a: Action.GetOps,
  ref: Ref,
  ops: NetTxnWithMeta[],
  v: I.FullVersionRange
}

export interface MutateResponse {
  a: Action.Mutate,
  ref: Ref,
  v: I.FullVersion,
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
  rv?: I.FullVersion,

  txns: NetTxnWithMeta[], // updates on top of replacement
  
  tv: I.FullVersion, // version diff
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
