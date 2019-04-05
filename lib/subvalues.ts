// This is a helper method for yielding the values out of a subscription, and
// ignoring everything else.
import * as I from './interfaces'
import {resultTypes} from './qrtypes'

export async function* subResults<Val>(type: I.ResultType, sub: I.Subscription<Val>) {
  const rtype = resultTypes[type]
  let last = rtype.create()
  let versions: I.FullVersionRange = []

  for await (const update of sub) {
    // console.log('upd', update)

    if (update.replace) {
      // TODO: Should we be pulling update.replace.versions in here?
      
      // console.log('replace', last, update.replace)
      last = rtype.updateResults(last, update.replace.q, update.replace.with)
      // console.log('->', last)
      update.replace.versions.forEach((v, si) => {
        if (v != null) versions[si] = {from:v, to:v}
      })
    }
    
    for (const txn of update.txns) {
      // This is like this because I haven't implemented apply for range results
      if (rtype.applyMut) rtype.applyMut!(last, txn.txn)
      else (last = rtype.apply(last, txn.txn))

      txn.versions.forEach((v, si) => {
        // The version *must* exist already in versions.
        if (v) versions[si]!.from = v
      })
    }
    
    update.toVersion.forEach((v, si) => {
      if (v != null) {
        if (versions[si] == null) versions[si] = {from:v, to:v}
        else versions[si]!.to = v
      }
    })

    yield {results: last!, versions, raw: update}
  }
}

export default async function* subValues<Val>(type: I.ResultType, sub: I.Subscription<Val>) {
  for await (const {results} of subResults(type, sub)) {
    yield results as Val
  }
}