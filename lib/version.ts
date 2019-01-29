import * as I from './interfaces'

const TWO_32 = Math.pow(2, 32) // Cannot be constructed via bit operations

// The easiest way to use versions is to use numbers internally and then use
// this version constructor, which makes a byte array out of the big-endian
// encoding of the specified number. The number must be an integer.
export const V64 = (x: number): I.Version => {
  if (x > Number.MAX_SAFE_INTEGER) throw Error('Cannot use normal number encoding on version above 2^53')

  const ab = new ArrayBuffer(8)
  const dataview = new DataView(ab)
  dataview.setUint32(0, x / TWO_32)
  dataview.setUint32(4, x & 0xffffffff)

  return new Uint8Array(ab)
}

export const V_EMPTY = new Uint8Array()

export const v64ToNum = (v: I.Version): number => {
  if (v.length !== 8) throw new Error('Invalid byte length in version')
  const dataview = new DataView(v.buffer, v.byteOffset, v.byteLength)
  return dataview.getUint32(0) * TWO_32 + dataview.getUint32(4)
}

export const vEnd = (v: I.FullVersionRange): I.FullVersion => {
  const result: I.FullVersion = {}
  for (const s in v) result[s] = v[s].to
  return result
}

export const vIncMut = (v: Uint8Array) => {
  let i = v.length
  while (i > 0 && v[--i]++ === 0xff);
  return v
}
export const vInc = (v: Uint8Array) => vIncMut(new Uint8Array(v))
export const vDecMut = (v: Uint8Array) => {
  let i = v.length
  while (i > 0 && v[--i]-- === 0x00);
  return v
}
export const vDec = (v: Uint8Array) => vDecMut(new Uint8Array(v))

// Lexographical comparison, though in reality versions should probably always
// have the same length. This is included so we don't need to bundle all of
// Buffer in the browser.
export const vCmp = (a: Uint8Array, b: Uint8Array) => {
  let i
  for (i = 0; i < a.length; i++) {
    if (i >= b.length) return 1
    const v = a[i] - b[i]
    if (v) return v
  }
  return (i < b.length) ? -1 : 0
}

export const vMax = (a: Uint8Array, b: Uint8Array) => vCmp(a, b) > 0 ? a : b
export const vMin = (a: Uint8Array, b: Uint8Array) => vCmp(a, b) > 0 ? b : a
export const vEq = (a: Uint8Array, b: Uint8Array) => vCmp(a, b) === 0

export const vIntersectMut = (dest: I.FullVersionRange, src: I.FullVersionRange) => {
  for (let source in src) {
    const {from: fromSrc, to: toSrc} = src[source]
    if (dest[source] == null) dest[source] = {from: fromSrc, to: toSrc}
    else {
      const {from:fromDest, to:toDest} = dest[source]
      if (vCmp(fromSrc, toDest) > 0 || vCmp(toSrc, fromDest) < 0) return null
      dest[source] = {from: vMax(fromDest, fromSrc), to: vMin(toDest, toSrc)}
    }
  }
  return dest
}
