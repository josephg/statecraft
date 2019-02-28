// This is a helper method for yielding the values out of a subscription, and
// ignoring everything else.
import * as I from './interfaces'
import {resultTypes} from './qrtypes'

export async function* subResults<Val>(type: I.ResultType, sub: I.Subscription<Val>) {
  let last: Val | null = null
  const rtype = resultTypes[type]
  let versions: I.FullVersionRange = {}

  for await (const update of sub) {
    for (const s in update.toVersion) {
      const v = update.toVersion[s]
      versions[s] = {from: v, to: v}
    }

    if (update.replace) {
      const val = update.replace.with
      last = val
      yield {results: last!, versions}
    }

    for (const txn of update.txns) {
      last = rtype.apply(last, txn.txn as I.SingleTxn<Val>)
      yield {results: last!, versions}
    }
  }
}
export default async function* subValues<Val>(type: I.ResultType, sub: I.Subscription<Val>) {
  for await (const {results} of subResults(type, sub)) {
    yield results
  }
}