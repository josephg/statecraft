// This is the master operation type documents.
//
// This is used for interpretting transactions sent to the server through
// mutate() and transactions sent to client subscriptions.
//
// It implements set and remove, and forwards the actual changes to
// child op types, which can be registered using the register function below.
import {SingleOp, Op} from './interfaces'
import {Type, AnyOTType} from './type'

export const typeRegistry: {[name: string]: AnyOTType} = {}
export const supportedTypes = new Set(['rm', 'set'])

export function register(type: AnyOTType) {
  typeRegistry[type.name] = type
  supportedTypes.add(type.name)
}

// register(require('../common/rangeops'))
// register(require('../common/setops'))



// The 'inc' type is a tiny dummy type.
register({
  name: 'inc',
  create(data) { return data|0 },
  apply(snapshot, op) { // Op is a number
    return snapshot + op
  },
})

export function typeOrThrow(typeName: string): AnyOTType {
  const type = typeRegistry[typeName]
  if (!type) throw Error('Unsupported type ' + typeName)
  return type
}


// TODO: + Register string, JSON, etc.


// I'm just going to export the utilities with the type. Its .. not ideal, but
// there's no clear line between what should be part of the result set type and
// what is just utility methods. This'll be fine for now.
