// This is a helper method for yielding the values out of a subscription, and
// ignoring everything else.
import * as I from './interfaces'
import fieldOps from './types/field'

export default async function* subValues<Val>(sub: I.Subscription<Val>) {
  let last: Val | null = null
  for await (const update of sub) {
    if (update.replace) {
      const val = update.replace.with
      yield val
      last = val
    }

    for (const txn of update.txns) {
      last = fieldOps.apply(last, txn.txn as I.SingleTxn<Val>)
      yield last
    }
  }
}