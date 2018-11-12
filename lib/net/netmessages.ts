import * as I from '../types/interfaces'
import {ErrJson} from '../err'

export type Ref = /*string |*/ number

export type NetKVTxn = [I.Key, I.Op][]
export type NetTxn = I.SingleTxn | NetKVTxn

export type NetQuery = 'single' | 'allkv' | [I.QueryType, any]

// **************** Client -> Server messages

export interface FetchRequest {
  a: 'fetch',
  ref: Ref,
  query: NetQuery,
  opts: I.FetchOpts,
}

export interface GetOpsRequest {
  a: 'getops',
  ref: Ref,
  query: NetQuery,
  v: I.FullVersionRange,
  opts: I.GetOpsOptions,
}

export interface MutateRequest {
  a: 'mutate',
  ref: Ref,
  mtype: I.ResultType,
  txn: any,
  v: I.FullVersion,
  opts: I.MutateOptions,
}

export interface SubscribeOpts {
  // TODO: Add all the rest!!!
  st?: string[]
  fv?: I.FullVersion | 'c', // known at versions
}

export interface SubCreate {
  a: 'sub create',
  ref: Ref,
  query: NetQuery,
  opts: SubscribeOpts
}

export interface SubClose {
  a: 'sub close',
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
  a: 'hello',
  p: 'statecraft',
  pv: number,
  sources: I.Source[], // ??? TODO: Still not sure whether to allow unknown sources.
  capabilities: any[]
}

export interface FetchResponse {
  a: 'fetch',
  ref: Ref,
  results: any, // Dependant on query.

  queryRun: NetQuery,
  versions: I.FullVersionRange, // Range across which version is valid.
}

// txn, version, meta.
export type NetTxnWithMeta = [any, I.FullVersion, any]

export interface GetOpsResponse {
  a: 'getops',
  ref: Ref,
  ops: NetTxnWithMeta[],
  v: I.FullVersionRange
}

export interface MutateResponse {
  a: 'mutate',
  ref: Ref,
  v: I.FullVersion,
}

export interface ResponseErr { // Used for fetch, mutate and getops
  a: 'err',
  ref: Ref,
  err: ErrJson,
}

export interface SubUpdate {
  a: 'sub update',
  ref: Ref,

  // Replace data. If r exists, q must exist too.
  q?: NetQuery, // active query diff
  r?: any, // replacement
  rv?: I.FullVersion,

  txns: NetTxnWithMeta[], // updates on top of replacement
  
  tv: I.FullVersion, // version diff
}

export interface SubUpdateErr {
  a: 'sub update err',
  ref: Ref,
  err: ErrJson,
}

// The subscription has closed
export interface SubRet {
  a: 'sub ret',
  ref: Ref,
}


export type SCMsg =
  HelloMsg
  | FetchResponse
  | GetOpsResponse
  | MutateResponse
  | ResponseErr
  | SubUpdate
  | SubUpdateErr
  | SubRet

// export const flatten1 = (data: any) => (data instanceof Map || data instanceof Set) ? Array.from(data) : data
