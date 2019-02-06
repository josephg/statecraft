// This is a simple implementation of a KV transaction on top of SC stores.
import * as I from './interfaces'
import err from './err'
import {vRangeTo, vToRange, vIntersectMut} from './version'
import streamToIter, {AsyncIterableIteratorWithRet} from './streamToIter'
import rtype from './types/map'

export interface TxnOpts {
  readOnly?: boolean
  readCache?: Map<I.Key, I.Val>
  v?: I.FullVersionRange
}

class Transaction {
  _store: I.Store
  _writeCache: Map<I.Key, I.Op>
  _v: I.FullVersionRange
  docsRead: Set<I.Key>

  _readOnly: boolean
  _readCache?: Map<I.Key, I.Val>

  constructor(store: I.Store, opts: TxnOpts) {
    // Consider relaxing this constraint here and just letting things work themselves out
    if (!store.storeInfo.capabilities.queryTypes.has('kv')) {
      throw new err.UnsupportedTypeError('transaction needs a kv store')
    }
    this._writeCache = new Map()
    this._store = store
    this._v = opts.v || {}
    this.docsRead = new Set()
    this._readOnly = !!opts.readOnly
    this._readCache = opts.readCache
  }

  async get(k: I.Key): Promise<I.Val> {
    if (this._readCache) {
      const val = this._readCache.get(k)
      if (val !== undefined) {
        this.docsRead.add(k)
        return val
      }
    }

    // There's a few ways we could write this. One way would be to pass the
    // txn version to fetch and let fetch throw, but that makes all stores
    // more complicated. Conflicts should be rare in practice, so actually
    // fetching the data then discarding it should be mostly fine. The one
    // downside to this method is that if stores support holding multiple
    // versions, then this is less efficient.
    // TODO: Eventually pass the requested version to fetch.
    const {results, versions} = await this._store.fetch(
      {type:'kv', q:new Set([k])},
      {atVersion: vRangeTo(this._v)}
    )
    const version = vIntersectMut(this._v, versions)
    if (version == null) {
      // Really we want the txn to return to the loop below, but this is the
      // only real way to do that in JS. Very poor perf, though again, txns
      // should be rare and this shouldn't be a big problem.
      throw new err.VersionTooOldError()
    }
    this._v = version
    this.docsRead.add(k)

    let val = (results as Map<I.Key, I.Val>).get(k) // Should be the only key.
    if (this._readCache) this._readCache.set(k, val)
    return val
  }

  set(k: I.Key, v: I.Val) {
    if (this._readOnly) throw Error('Cannot write to read-only transaction')
    this._writeCache.set(k, {type: 'set', data: v})
  }
  rm(k: I.Key) {
    this._writeCache.set(k, {type: 'rm', data: true})
  }
  op(k: I.Key, type: string, data: any) {
    // For OT.
    this._writeCache.set(k, {type, data})
  }

  // TODO: Support range reads too.

  async commit() {
    if (this._writeCache.size > 0) {
      return this._store.mutate('kv', this._writeCache, vRangeTo(this._v), {
        conflictKeys: Array.from(this.docsRead)
      })
    }
  }

  _reset() {
    // There's more efficient ways to write this - I could keep track of the
    // versions of the data items and only throw away stuff that actually
    // conflicted.
    this.docsRead.clear()
    this._writeCache.clear()
    this._v = {}
  }
}

const doTxn = async <T>(store: I.Store, fn: (txn: Transaction) => Promise<T>, opts: TxnOpts = {}): Promise<I.FetchResults<T>> => {
  const txn = new Transaction(store, opts)
  while (true) {
    try {
      const results = await fn(txn)
      await txn.commit() // Throwing the commit version away here. We could keep it...??.
      return {
        versions: txn._v,
        results,
      }
    } catch (e) {
      if (!(e instanceof err.VersionTooOldError || e instanceof err.WriteConflictError)) throw e
      // Otherwise retry.
    }
    txn._reset()

    // Exponential backoff?
  }
}
export default doTxn

export const txnSubscribe = <T>(store: I.Store, fn: (txn: Transaction) => Promise<T>): AsyncIterableIteratorWithRet<T> => {
  let stop = false
  const stream = streamToIter<T>(() => {
    stop = true
  })

  ;(async () => {
    const cache = new Map
    let {results: [data, txn], versions} = await doTxn(store, async txn => [await fn(txn), txn] as [T, Transaction], {
      readOnly: true,
      readCache: cache,
    })
    // console.log('initia')
    stream.append(data)
    let v = vRangeTo(versions)

    while (true) {
      // console.log('making sub', Array.from(txn.docsRead))
      let sub = store.subscribe({type: 'kv', q: txn.docsRead}, {
        fromVersion: v,
        aggregate: 'yes',
      })

      for await (const catchup of sub) {
        if (stop) { sub.return(); return }
        // console.log('catchup', catchup)

        if (catchup.replace) {
          if (catchup.replace.q.type !== 'kv') throw new err.UnsupportedTypeError('only kv subscribe txns supported')
          rtype.updateResults(cache, catchup.replace.q, catchup.replace.with)
        }
        catchup.txns.forEach(txn => {rtype.applyMut!(cache, txn.txn as I.KVTxn)})

        // Ok; now re-run the function. If we end up fetching more / different
        // documents, we'll need to bail out and re-make the subscription.

        for (const s in catchup.toVersion) v[s] = catchup.toVersion[s]
        txn._v = vToRange(v)
        const cachePreSize = cache.size
        // console.log('cache 1', Array.from(cache.keys()))
        
        if (catchup.replace || catchup.txns.length) {
          try {
            txn.docsRead.clear()
            data = await fn(txn)
            stream.append(data)
          } catch (e) {
            if (!(e instanceof err.VersionTooOldError)) throw e
            // Some data has changed. We'll wait until we get the updated data from
            // the subscription, then re-run the function.
            continue
          }
        }

        if (stop) { sub.return(); return }
        
        v = vRangeTo(txn._v)

        // The txn fetched some new documents. We'll recreate the
        // subscription. We could instead look at txn.docsRead - that might be
        // better if the doc set strictly shrinks
        if (cache.size !== cachePreSize) break
        // console.log('cache 2', Array.from(cache.keys()))
      }

      // trim cache down to just the documents actually requested.
      // console.log('trim', Array.from(txn.docsRead), Array.from(cache.keys()))
      for (const k of cache.keys()) if (!txn.docsRead.has(k)) cache.delete(k)
      sub.return()
    }
  })()

  return stream.iter
}
