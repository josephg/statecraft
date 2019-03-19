// This is a helper method like subValues which will give you a feed of values
// out of a SimpleStore.

// This is a simple way to avoid needing to wrap a simple store with subgroup -
// the only real benefit of which is to avoid a bunch of code in the browser bundle.
import * as I from './interfaces'
// import {resultTypes} from './qrtypes'
import field from './types/field'
import {vCmp} from './version'

// It feels heavy pulling this in, but its used by the network client anyway so its
// not a big deal.
import streamToIter, {Stream} from './streamToIter'

export default async function* simpleValuesSingle<Val>(store: I.SimpleStore<Val>): AsyncIterableIterator<Val> {
  if (store.onTxn) throw new Error('Cannot use simpleValues on a store with onTxn set. Wrap store with augment / subgroup.')
  const sources = store.storeInfo.sources
  if (sources.length > 1) throw new Error('Cannot wrap store with multiple sources')
  const source = sources[0]

  const rtype = field //resultTypes.single
  let buffer: {txn: I.Txn<Val>, v: I.Version}[] | null = []
  let version: I.Version
  let val: Val | undefined // Set after fetch first returns
  const stream = streamToIter<I.Txn<Val>>()

  store.onTxn = (source, fromV, toV, type, txn, meta) => {
    if (buffer != null) buffer.push({txn, v:toV})
    else stream.append(txn)
  }
  
  const r = await store.fetch({type: 'single', q:true})
  version = r.versions[0]!.to
  val = r.results
  buffer.forEach(({txn, v}) => {
    if (vCmp(v, version) <= 0) return
    else val = rtype.apply(val, txn as I.SingleTxn<Val>)
  })
  buffer = null
  yield val!

  for await (const txn of stream.iter) {
    val = rtype.apply(val, txn as I.SingleTxn<Val>)
    yield val!
  }
}