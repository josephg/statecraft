// This is a helper method for yielding the values out of a subscription, and
// ignoring everything else.
import * as I from './interfaces'
import {resultTypes} from './qrtypes'

export async function* subResults<Val>(type: I.ResultType, sub: I.Subscription<Val>) {
  const rtype = resultTypes[type]
  let last = rtype.create()
  let versions: I.FullVersion = []

  for await (const update of sub) {
    // console.log('upd', update)
    
    update.toVersion.forEach((v, si) => {
      if (v != null) versions[si] = v
    })

    if (update.replace) {
      // TODO: Should we be pulling update.replace.versions in here?
      
      // console.log('replace', last, update.replace)
      last = rtype.updateResults(last, update.replace.q, update.replace.with)
      // console.log('->', last)
    }

    for (const txn of update.txns) {
      // This is like this because I haven't implemented apply for range results
      if (rtype.applyMut) rtype.applyMut!(last, txn.txn)
      else (last = rtype.apply(last, txn.txn))
    }

    yield {results: last!, versions, raw: update}
  }
}

export default async function* subValues<Val>(type: I.ResultType, sub: I.Subscription<Val>) {
  for await (const {results} of subResults(type, sub)) {
    yield results
  }
}