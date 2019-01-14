// This is a simple implementation of a KV transaction on top of SC stores.
import * as I from './interfaces'
import err from './err'
import {vEnd, vIntersectMut} from './version'

class Transaction {
  _store: I.Store
  _writeCache: Map<I.Key, I.Op>
  _v: I.FullVersionRange
  _readConflictKeys: Set<I.Key>

  constructor(store: I.Store) {
    // Consider relaxing this constraint here and just letting things work themselves out
    if (!store.storeInfo.capabilities.queryTypes.has('kv')) {
      throw new err.UnsupportedTypeError('transaction needs a kv store')
    }
    this._writeCache = new Map()
    this._store = store
    this._v = {}
    this._readConflictKeys = new Set()
  }

  async get(k: I.Key): Promise<I.Val> {
    // There's a few ways we could write this. One way would be to pass the
    // txn version to fetch and let fetch throw, but that makes all stores
    // more complicated. Conflicts should be rare in practice, so actually
    // fetching the data then discarding it should be mostly fine. The one
    // downside to this method is that if stores support holding multiple
    // versions, then this is less efficient.
    // TODO: Eventually pass the requested version to fetch.
    const {results, versions} = await this._store.fetch({type:'kv', q:new Set([k])}, {})
    const v = vIntersectMut(this._v, versions)
    if (v == null) {
      // Really we want the txn to return to the loop below, but this is the
      // only real way to do that in JS. Very poor perf, though again, txns
      // should be rare and this shouldn't be a big problem.
      throw new err.TxnConflictError()
    }
    this._v = v
    this._readConflictKeys.add(k)
    return (results as Map<I.Key, I.Val>).get(k) // Should be the only key.
  }

  set(k: I.Key, v: I.Val) {
    this._writeCache.set(k, {type: 'set', data: v})
  }
  rm(k: I.Key) {
    this._writeCache.set(k, {type: 'rm', data: true})
  }
  op(k: I.Key, type: string, data: any) {
    // For OT.
    this._writeCache.set(k, {type, data})
  }

  async commit() {
    if (this._writeCache.size > 0) {
      return this._store.mutate('kv', this._writeCache, vEnd(this._v), {
        conflictKeys: Array.from(this._readConflictKeys)
      })
    }
  }

  _reset() {
    // There's more efficient ways to write this - I could keep track of the
    // versions of the data items and only throw away stuff that actually
    // conflicted.
    this._readConflictKeys.clear()
    this._writeCache.clear()
    this._v = {}
  }
}

const doTxn = async <T>(store: I.Store, fn: (txn: Transaction) => Promise<T>): Promise<T> => {
  const txn = new Transaction(store)
  while (true) {
    try {
      const result = await fn(txn)
      await txn.commit() // Throwing the commit version away here. We could keep it...??.
      return result
    } catch (e) {
      if (!(e instanceof err.TxnConflictError || e instanceof err.WriteConflictError)) throw e
      // Otherwise retry.
    }
    txn._reset()

    // Exponential backoff?
  }
}
export default doTxn