import * as I from '../types/interfaces'
import {ErrJson} from '../err'

export type Ref = string | number

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
  kd?: boolean | I.Key[], // known docs
  kv?: I.FullVersion, // known at versions
}

export interface SubCreate {
  a: 'sub create',
  ref: Ref,
  query: NetQuery,
  opts: SubscribeOpts
}

export interface SubNext {
  a: 'sub next',
  ref: Ref, // Ref of subscription
  opts: any,
}

export interface SubCancel {
  a: 'sub cancel',
  ref: Ref, // Ref of subscription
}

export type CSMsg =
  FetchRequest
  | MutateRequest
  | GetOpsRequest
  | SubCreate
  | SubNext
  | SubCancel


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

export type NetTxnWithMeta = [any, I.FullVersion]
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
  rv: I.FullVersionRange, // version diff

  // if r exists, q must exist too.
  q?: NetQuery, // active query diff
  r?: any, // replacement

  txns: {v: I.FullVersion, txn: any}[], // updates on top of replacement
}

export interface SubNextCallback {
  a: 'sub next',
  ref: Ref,

  // activeQuery and activeVersions
  q: NetQuery,
  v: I.FullVersionRange,

  c: boolean, // is the subscription now complete?
}

export interface SubNextErr {
  a: 'sub next err',
  ref: Ref,
  err: ErrJson,
}


export type SCMsg =
  HelloMsg
  | FetchResponse
  | GetOpsResponse
  | MutateResponse
  | ResponseErr
  | SubUpdate
  | SubNextCallback
  | SubNextErr

// export const flatten1 = (data: any) => (data instanceof Map || data instanceof Set) ? Array.from(data) : data
