import * as I from './interfaces'
import {ErrJson} from '../err'

export type Ref = string | number

export type NetKVTxn = [I.Key, I.Op][]
export type NetTxn = I.SingleTxn | NetKVTxn

// **************** Client -> Server messages

export interface FetchRequest {
  a: 'fetch',
  ref: Ref,
  qtype: I.QueryType,
  query: any,
  opts: I.FetchOpts,
}

export interface GetOpsRequest {
  a: 'getops',
  ref: Ref,
  qtype: I.QueryType,
  query: any,
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

export interface SubCreate {
  a: 'sub create',
  ref: Ref,
  qtype: I.QueryType,
  query: any,
  opts: I.SubscribeOpts
}

export interface SubNext {
  a: 'sub next',
  ref: Ref,
  opts: any,
}

export interface SubCancel {
  a: 'sub cancel',
  ref: Ref,
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
  sources?: I.Source[], // ??? TODO: Still not sure whether to allow unknown sources.
  capabilities: any[]
}

export interface FetchResponse extends I.FetchResults {
  a: 'fetch',
  ref: Ref,
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

export interface SubUpdateAggregate {
  a: 'sub update',
  ref: Ref,
  rv: I.FullVersionRange, // Resulting version

  type: 'aggregate',
  txn: NetTxn,
  v: I.FullVersionRange,
}

export interface SubUpdateTxns {
  a: 'sub update',
  ref: Ref,
  rv: I.FullVersionRange, // Resulting version

  // This is all sort of gross.
  type: 'txns',
  txns: {v: I.FullVersion, txn: any}[]
}

export interface SubNextCallback {
  a: 'sub next',
  ref: Ref,

  // activeQuery and activeVersions
  q: any,
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
  | SubUpdateTxns
  | SubUpdateAggregate
  | SubNextCallback
  | SubNextErr

// export const flatten1 = (data: any) => (data instanceof Map || data instanceof Set) ? Array.from(data) : data
