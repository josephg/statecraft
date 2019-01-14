import * as I from './interfaces'

export const vEnd = (v: I.FullVersionRange): I.FullVersion => {
  const result: I.FullVersion = {}
  for (const s in v) result[s] = v[s].to
  return result
}

export const vIntersectMut = (dest: I.FullVersionRange, src: I.FullVersionRange) => {
  for (let source in src) {
    const {from: fromSrc, to: toSrc} = src[source]
    if (dest[source] == null) dest[source] = {from: fromSrc, to: toSrc}
    else {
      const {from:fromDest, to:toDest} = dest[source]
      if (fromSrc > toDest || toSrc < fromDest) return null
      dest[source] = {from: Math.max(fromDest, fromSrc), to: Math.min(toDest, toSrc)}
    }
  }
  return dest
}
