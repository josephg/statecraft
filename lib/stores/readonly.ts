// Read only store wrapper
import * as I from '../interfaces'

export default function readOnly<Val, S extends I.Store<Val> | I.SimpleStore<Val>>(inner: S): S {
  // This is pretty messy.. :/
  const outer: S = {
    storeInfo: {
      ...inner.storeInfo,
      capabilities: {
        ...inner.storeInfo.capabilities,
        mutationTypes: new Set()
      }
    },

    mutate() {
      throw Error('Mutation not allowed')
    },
  } as any as S

  for (const k in inner) {
    if (k !== 'mutate' && k !== 'storeInfo') {
      const v = inner[k]
      if (typeof v === 'function') outer[k] = v.bind(inner)
    }
  }

  inner.onTxn = (...args) => {
    if (outer.onTxn) outer.onTxn(...args)
  }

  return outer
}