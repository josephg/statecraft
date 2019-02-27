// This is a helper method for yielding the values out of a subscription, and
// ignoring everything else.
import * as I from './interfaces'
import {resultTypes} from './qrtypes'

export default async function* subValues<Val>(type: I.ResultType, sub: I.Subscription<Val>) {
  let last: Val | null = null
  const rtype = resultTypes[type]

  for await (const update of sub) {
    if (update.replace) {
      const val = update.replace.with
      last = val
      yield last!
    }

    for (const txn of update.txns) {
      last = rtype.apply(last, txn.txn as I.SingleTxn<Val>)
      yield last!
    }
  }
}