// Common API for interacting with queries
import kvQuery from './kvqueryops'
import {Type, QueryOps, ResultOps} from './type'
import {allkvQueryOps, contentQueryOps, singleDocResult} from './simplequery'
import resultMap from './resultmap'
import * as I from './interfaces'

type SetOrMap<T> = Map<T, any> | Set<T>
function eachIntersect<T>(c1: SetOrMap<T>, c2: SetOrMap<T>, fn: (v:T) => void) {
  // This works on maps and sets.
  if (c1.size > c2.size) {
    for (let k of c2.keys()) if (c1.has(k)) fn(k)
  } else {
    for (let k of c1.keys()) if (c2.has(k)) fn(k)
  }
}

export const snapToJSON = <S, O>(type: Type<S, O>, data: S): any =>
  type.snapToJSON ? type.snapToJSON(data) : data
export const snapFromJSON = <S, O>(type: Type<S, O>, data: any): S =>
  type.snapFromJSON ? type.snapFromJSON(data) : type.create(data)
export const opToJSON = <S, O>(type: Type<S, O>, data: O): any =>
  type.opToJSON ? type.opToJSON(data) : data
export const opFromJSON = <S, O>(type: Type<S, O>, data: any): O =>
  type.opFromJSON ? type.opFromJSON(data) : data


export const queryTypes: {[name: string]: {
  q: QueryOps<any, any>,
  r: ResultOps<any, I.Txn>,
  filterTxn(txn: I.Txn, query: any): any | null,
}} = {
  single: {
    q: contentQueryOps,
    r: singleDocResult,
    filterTxn(txn, query) { return query ? txn : null },
  },
  allkv: {
    q: allkvQueryOps,
    r: resultMap,
    filterTxn(txn, query) { return query ? txn : null },
  },
  kv: {
    q: kvQuery,
    r: resultMap,
    filterTxn(txn: I.KVTxn, query) {
      let result: I.KVTxn | null = null
      eachIntersect<I.Key>(txn, query, k => {
        if (result == null) result = new Map<I.Key, I.Op>()
        result.set(k, <I.Op>txn.get(k))
      })
      return result
    },
  }
}

export const resultTypes: {
  [name: string]: ResultOps<any, I.Txn>
} = {
  single: singleDocResult,
  resultmap: resultMap,
}
