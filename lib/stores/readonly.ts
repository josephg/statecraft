// Read only store wrapper
import * as I from '../interfaces'

export default function readOnly<S extends I.Store | I.SimpleStore>(inner: S): S {
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