// This is a helper method for yielding the values out of a subscription, and
// ignoring everything else.
import * as I from './interfaces'
import {resultTypes} from './qrtypes'

/**
 * This is a state machine which can process catchup objects. Each time the
 * object transitions, the transition function returns the new state.
 *
 * TODO: Consider finding a way to return the initial value when the object is
 * first created
 *
 * @param type The expected result type of the incoming catchup data
 * @returns Transition function
 */
export const catchupStateMachine = <Val>(type: I.ResultType) => {
  const rtype = resultTypes[type]
  let value = rtype.create()
  const versions: I.FullVersionRange = []

  return (update: I.CatchupData<Val>): I.FetchResults<Val> => {
    if (update.replace) {
      // TODO: Should we be pulling update.replace.versions in here?
      
      // console.log('replace', value, update.replace)
      value = rtype.updateResults(value, update.replace.q, update.replace.with)
      // console.log('->', value)
      update.replace.versions.forEach((v, si) => {
        if (v != null) versions[si] = {from:v, to:v}
      })
    }
    
    for (const txn of update.txns) {
      // This is like this because I haven't implemented apply for range results
      if (rtype.applyMut) rtype.applyMut!(value, txn.txn)
      else (value = rtype.apply(value, txn.txn))

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

    return {results: value!, versions}
  }
}

// TODO: Refactor things so we don't need a ResultType passed in here.
export async function* subResults<Val>(type: I.ResultType, sub: I.Subscription<Val>) {
  const u = catchupStateMachine(type)
  for await (const update of sub) {
    // console.log('upd', update)
    yield {...u(update), raw: update}
  }
}

export default async function* subValues<Val>(type: I.ResultType, sub: I.Subscription<Val>) {
  const u = catchupStateMachine(type)
  for await (const update of sub) {
    yield u(update).results // A Val if type is single, or a container of Vals
  }
}