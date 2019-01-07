import * as I from '../interfaces'
import err from '../err'
import fieldOps from './field'
import binsearch from 'binary-search'


const cmp = <T>(a: T, b: T) => a < b ? -1 : a > b ? 1 : 0
const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x)

export const findRaw = (sel: I.KeySelector | I.StaticKeySelector, keys: ArrayLike<I.Key>): number => {
  const pos = binsearch(keys, sel.k, cmp)

  return clamp((pos < 0
    ? -pos-1
    : sel.isAfter ? pos+1 : pos
  ), 0, keys.length)
}

export const findRangeStatic = (range: I.StaticRange, keys: ArrayLike<I.Key>) => {
  const spos = findRaw(range.low, keys)
  const epos = findRaw(range.high, keys)
  // The semantics of the way we're using .slice() below means we don't need
  // to clamp these positions at the top end.
  // return [max(spos, 0), max(epos, 0)]
  return [spos, epos]
}


// The keys must be sorted.
// type RangeResult = [Key, Val][][]
// type RangeTxn = [Key, Op][][]

// const pair = function* <A, B>(a: Iterator<A>, b: Iterator<B>): Iterator<[A, B]> {
//   while (true) {
//     let av = a.next()
//     let bv = b.next()
//     if (av.done || bv.done) break
//     else yield [av.value, bv.value]
//   }
// }

type KVPair = [I.Key, I.Val]

const mapRangeEntry = <T, R>(input: [I.Key, T][][], fn: (key: I.Key, val: T) => [I.Key, R] | null) => (
  input.map(inner =>
    inner.map(([key, val]) => fn(key, val)).filter(e => e != null) as [I.Key, R][]
  )
)

// Could be implemented in terms of the above.
const mapRange = <T, R>(input: [I.Key, T][][], fn: (x: T, k: I.Key) => R) => (
  input.map(inner =>
    inner.map(([key, val]) => [key, fn(val, key)] as [I.Key, R])
  )
)

const mapRangeEntryAsync = async <T, R>(input: [I.Key, T][][], fn: (key: I.Key, val: T) => Promise<[I.Key, R] | null>) => {
  let result: I.RangeResult = []
  for (let i = 0; i < input.length; i++) {
    result.push((await Promise.all(input[i].map(([k, v]) => fn(k, v)))).filter(e => e != null) as [I.Key, R][])
  }
  return result
}
const mapRangeAsync = <T, R>(input: [I.Key, T][][], fn: (val: T, key: I.Key) => Promise<R>) => (
  mapRangeEntryAsync(input, (k, v) => fn(v, k).then(v2 => ([k, v2] as [I.Key, R])))
)

const walk2 = <T>(a: [I.Key, T][], b: [I.Key, T][], fn: (k: I.Key, a: T | null, b: T | null) => void) => {
  let ai = 0, bi = 0

  while (ai < a.length && bi < b.length) {
    const [ak, av] = a[ai]
    const [bk, bv] = b[bi]

    if (ak < bk) { fn(ak, av, null); ai++ }
    else if (ak > bk) { fn(bk, null, bv); bi++ }
    else { // equal.
      fn(ak, av, bv)
      ai++
      bi++
    }
  }
  for (; ai < a.length; ai++) fn(a[ai][0], a[ai][1], null)
  for (; bi < b.length; bi++) fn(b[bi][0], null, b[bi][1])
}

const id = <T>(x: T) => x

const type: I.ResultOps<I.RangeResult, I.RangeTxn> = {
  name: 'range',

  create(data) {
    if (data == null) return []
    else if (!Array.isArray(data)) throw new err.InvalidDataError()
    else return data as I.RangeResult
  },

  applyMut(snap, op) {
    for (let i = 0; i < snap.length; i++) {
      const snapc = snap[i]
      const opc = op[i]

      let snapi = 0
      for (let opi = 0; opi < opc.length; opi++) {
        let [opk, fieldOp] = opc[opi]

        // TODO: Rewrite this to use binary search or something. This will be
        // slow with large result sets
        let key: I.Key
        while ((key = snapc[snapi][0]) < opk) snapi++

        if (key === opk) {
          snapc[snapi][1] = fieldOps.apply(snapc[snapi][1], fieldOp)
        } else {
          // Insert it into the snapshot.
          snapc.splice(snapi, 0, fieldOps.apply(null, fieldOp))
        }
        snapi++
      }
    }
  },

  apply(snap, op) { throw Error('Not implemented') },

  compose(op1, op2) { throw Error('not implemented') },
  
  composeResultsMut(dest, src) {
    // The two range result objects were created from the same query.
    if (dest.length !== src.length) throw new err.InvalidDataError()
    return dest.map((d, i) => {
      const r: [I.Key, I.Val][] = []
      walk2(d, src[i], (k, a, b) => {
        r.push([k, b != null ? b : a])
      })
      return r
    })
  },

  copyInto(dest, src) {
    dest.push(...src)
    return dest
  },

  mapEntries: mapRangeEntry,
  mapEntriesAsync: mapRangeEntryAsync,
  map: mapRange,
  mapAsync: mapRangeAsync,
  mapTxn: mapRange,
  mapTxnAsync: mapRangeAsync,

  mapReplace: (s: I.RangeResult[], fn) => s.map(e => mapRange(e, fn)),

  snapToJSON: id,
  snapFromJSON: id,
  opToJSON: id,
  opFromJSON: id,

  // Ok this one is a bit weird. We can't actually figure out the query that
  // generated this, so we'll make a KV query instead. You'll need to be
  // careful with this because the type of the results doesn't match the type
  // of the input query. This is used for fetching historical operations for
  // OT - so this should be safe.
  getCorrespondingQuery(snap) {
    const keys = new Set<I.Key>()
    for (let i = 0; i < snap.length; i++) {
      snap[i].forEach(([k]) => keys.add(k))
    }

    return {type: 'kv', q: keys}
  },

  filterSupportedOps(op, view: Map<I.Key, I.Val>, supportedTypes) {
    return mapRange(op, (o, k) => (
      fieldOps.filterSupportedOps(o, view.get(k), supportedTypes))
    )
  },

  // isStaticRange(q: StaticRange | Range): q is StaticRange {
  //   if ((q as Range).limit) return false
  // },
}

export default type