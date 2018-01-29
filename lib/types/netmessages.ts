import * as I from './interfaces'
import {ErrJson} from '../err'

export type Ref = string | number


// **************** Client -> Server messages

export interface FetchRequest {
  a: 'fetch',
  ref: Ref,
  qtype: I.QueryType,
  query: any,
  opts: I.FetchOpts,
}

export interface MutateRequest {
  a: 'mutate',
  ref: Ref,
  mtype: I.ResultType,
  txn: I.Txn,
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

export interface MutateResponse {
  a: 'mutate',
  ref: Ref,
  v: I.FullVersion,
}

export interface ResponseErr { // Used for fetch and mutate
  a: 'err',
  ref: Ref,
  err: ErrJson,
}

export interface SubUpdateAggregate {
  a: 'sub update',
  ref: Ref,
  rv: I.FullVersionRange, // Resulting version

  type: 'aggregate',
  txn: any,
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
  | MutateResponse
  | ResponseErr
  | SubUpdateTxns
  | SubUpdateAggregate
  | SubNextCallback
  | SubNextErr

// export const flatten1 = (data: any) => (data instanceof Map || data instanceof Set) ? Array.from(data) : data
