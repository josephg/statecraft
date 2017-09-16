import {QueryOps, ResultOps} from './type'
import fieldOps from './fieldops'
import {Op} from './interfaces'

export const contentQueryOps: QueryOps<boolean, boolean> = {
  name: 'content',
  create(val) { return !!val },
  apply(snap, op) { return op },

  // Ugh, uh:
  // split(false, false) = [false, false]
  // split(false, true)  = [false, false]
  // split(true,  false) = [false, true]
  // split(true,  true)  = [true, false]
  split(op, snap) { return [op && snap, op && !snap] },

  intersectDocs(a, b) { return a && b },
  isEmpty(snap) { return snap === false },
  isNoop(op) { return op === false },

  add(a, b) { return a || b },
  subtract(a, b) { return a && !b },
  // getResultType() { return singleDocResult }
}

export const allkvQueryOps: QueryOps<boolean, boolean> = {
  name: 'allkv',
  // getResultType() { return resultMap },
  ...contentQueryOps
}

export const singleDocResult = fieldOps
