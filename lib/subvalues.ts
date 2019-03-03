// This is a helper method for yielding the values out of a subscription, and
// ignoring everything else.
import * as I from './interfaces'
import {resultTypes} from './qrtypes'

export async function* subResults<Val>(type: I.ResultType, sub: I.Subscription<Val>) {
  const rtype = resultTypes[type]
  let last = rtype.create()
  let versions: I.FullVersionRange = {}

  for await (const update of sub) {
    // console.log('upd', update)
    
    for (const s in update.toVersion) {
      const v = update.toVersion[s]
      versions[s] = {from: v, to: v}
    }

    if (update.replace) {
      // console.log('replace', last, update.replace)
      last = rtype.updateResults(last, update.replace.q, update.replace.with)
      // const val = update.replace.with
      // last = val
      yield {results: last!, versions}
    }

    for (const txn of update.txns) {
      // This is like this because I haven't implemented apply for range results
      if (rtype.applyMut) rtype.applyMut!(last, txn.txn)
      else (last = rtype.apply(last, txn.txn))

      yield {results: last!, versions}
    }
  }
}

export default async function* subValues<Val>(type: I.ResultType, sub: I.Subscription<Val>) {
  for await (const {results} of subResults(type, sub)) {
    yield results
  }
}