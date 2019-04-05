// This is a simple passthrough store which catches write conflicts and tries
// to do operational tranformation to recover them.
import * as I from '../interfaces'
import err from '../err'
import {queryTypes, resultTypes} from '../qrtypes'
import {typeOrThrow} from '../typeregistry'

const mapTxnWithPair = <Val>(type: I.ResultType, a: I.Txn<Val>, b: I.Txn<Val>, fn: (a: I.SingleTxn<Val>, b: I.SingleTxn<Val>) => I.SingleTxn<Val>) => {
  if (a instanceof Map) {
    const result = new Map<I.Key, I.Op<Val>>()
    if (!(b instanceof Map)) throw new err.InvalidDataError('Transactions are different types')
    for (const [k, av] of a.entries()) {
      const bv = b.get(k)
      if (bv != null) result.set(k, fn(av, bv))
      else result.set(k, av)
    }
    return result
  } else if (type === I.ResultType.Single) {
    return fn(a as I.Op<Val>, b as I.Op<Val>)
  } else {
    throw new err.UnsupportedTypeError('Type ' + type + ' not supported by ot store')
    // throw new err.InvalidDataError('Transactions are different types')
  }
}

const eachOp = <Val>(op: I.Op<Val>, fn: (op: I.SingleOp<Val>) => void) => {
  if (Array.isArray(op)) op.forEach(fn)
  else fn(op)
}

const otStore = <Val>(inner: I.Store<Val> /*, filter: (key: I.Key) => boolean */): I.Store<Val> => {

  return {
    ...inner,

    async mutate(type, txn, versions, opts = {}) {
      // First try to just submit the operation directly.
      while (true) {
        try {
          const result = await inner.mutate(type, txn, versions, opts)
          return result
        } catch (e) {
          // console.error('Caught error in mutate', e.stack)
          if (!(e instanceof err.WriteConflictError)
              || versions == null) {
            throw e
          }

          const uid = opts.meta ? opts.meta.uid : undefined

          // console.log('wowooo got a write conflict')

          // We don't know what conflicted, and the transaction could have a
          // lot of stuff in it.
          const q = resultTypes[type].getCorrespondingQuery(txn)

          // This is a terrible error message for a complex error. Should be
          // pretty rare in practice - basically the mutation type has to
          // match the type of the corresponding query. Which will basically
          // always be kv or single.
          if (queryTypes[q.type].resultType.type !== type) throw Error(`Mismatched query types unsupported ${queryTypes[q.type].resultType.name} != ${type}`)

          // empty to version == all.
          const catchupVersions: I.FullVersionRange = versions.map(v => v == null ? null : {from: v, to: new Uint8Array()})
          const {ops} = await inner.getOps(q, catchupVersions)
          if (ops.length === 0) throw e // Can't make progress.

          let madeProgress = false
          for (let i = 0; i < ops.length; i++) {
            if (uid != null && ops[i].meta.uid === uid) {
              // The transaction has actually already been applied - we just
              // found it. We don't need to do any more work; just return as
              // if this txn was the txn you tried to submit.
              return ops[i].versions
            }
            
            txn = mapTxnWithPair(type, txn, ops[i].txn, (a, b) => {
              // The mutation we recieved has not been collapsed together.
              // This requires an M*N transform, which is not implemented.
              if (Array.isArray(a)) throw e
              if (a.type === 'set' || a.type === 'rm') throw e
              const type = typeOrThrow(a.type)
              if (type.transform == null) throw e

              let {data} = a
              eachOp(b, (bop) => {
                // Can't transform if they're a different type
                if (a.type !== bop.type) throw e
                // console.log('xf', data, bop.data)
                data = type.transform!(data, bop.data, 'left')
                // console.log('->', data)
                madeProgress = true
              })
              return {type: a.type, data}
            })

            ops[i].versions.forEach((v, si) => {
              if (v != null && versions[si] != null) versions[si] = v
            })
          }

          // If we didn't make progress, abort to avoid an infinite loop.
          // The store is generating a conflict for some other reason. Let it be.
          if (!madeProgress) throw e

          // console.log('retrying with', txn)
        }
      }
    }
  }
}

export default otStore
