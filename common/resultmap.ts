import {ResultOps} from './type'
import * as I from './interfaces'
import fieldOps from './fieldops'

const type: ResultOps<Map<I.Key, I.Val>, I.KVTxn> = {
  name: 'resultmap',
  
  create(data) {
    return data instanceof Map ? data : new Map(data)
  },

  apply(snap, op) {
    for (var [k, docop] of op) {
      const oldval = snap.get(k)
      const newval = fieldOps.apply(oldval, docop)
      // I'm actually going to leave nulls in the map where docs were removed.
      // When snapshots are turned into self-updates we need to differentiate
      // between 'no-change' and 'removed'. Its a bit of a hack though.
      snap.set(k, newval == null ? null : newval)
    }
    return snap
  },

  asOp(snap) {
    const op = new Map<I.Key, I.Op>()
    for (var [k, val] of snap) {
      op.set(k, (val == null) ? {type:'rm'} : {type:'set', data:val})
    }
    return op
  },

  composeMut(txn, other) {
    for (const [k, op] of other) {
      const orig = txn.get(k)
      if (orig == null) txn.set(k, op)
      else {
        txn.set(k, fieldOps.compose(orig, op))
      }
    }
  },

  compose(a, b) {
    const result = new Map(a)
    type.composeMut!(result, b)
    return result
  },

  from(type, data) {
    switch(type) {
      case 'doc': return new Map<I.Key, I.Val>([['content', data]])
      case 'resultmap': return data
    }
  }
}
export default type
