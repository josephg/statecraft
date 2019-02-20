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

type Val = any
type KVPair = [I.Key, Val]

const mapRangeEntry = <In, Out>(input: [I.Key, In][][], fn: (key: I.Key, val: In) => [I.Key, Out] | null) => (
  input.map(inner =>
    inner.map(([key, val]) => fn(key, val)).filter(e => e != null) as [I.Key, Out][]
  )
)

// Could be implemented in terms of the above.
const mapRange = <In, Out>(input: [I.Key, In][][], fn: (x: In, k: I.Key) => Out) => (
  input.map(inner =>
    inner.map(([key, val]) => [key, fn(val, key)] as [I.Key, Out])
  )
)

const mapRangeEntryAsync = async <In, Out>(input: [I.Key, In][][], fn: (key: I.Key, val: In) => Promise<[I.Key, Out] | null>) => {
  let result: I.RangeResult<Out> = []
  for (let i = 0; i < input.length; i++) {
    result.push((await Promise.all(input[i].map(([k, v]) => fn(k, v)))).filter(e => e != null) as [I.Key, Out][])
  }
  return result
}
const mapRangeAsync = <In, Out>(input: [I.Key, In][][], fn: (val: In, key: I.Key) => Promise<Out>) => (
  mapRangeEntryAsync(input, (k, v) => fn(v, k).then(v2 => ([k, v2] as [I.Key, Out])))
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

const type: I.ResultOps<Val, I.RangeResult<Val>, I.RangeTxn<Val>> = {
  name: 'range',

  create(data) {
    if (data == null) return []
    else if (!Array.isArray(data)) throw new err.InvalidDataError()
    else return data as I.RangeResult<any>
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
      const r: [I.Key, Val][] = []
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

  mapReplace: <In, Out>(s: I.RangeResult<In>[], fn: (v: In, k: I.Key | null) => Out) => s.map(e => mapRange(e, fn)),

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

  filterSupportedOps(op, view: Map<I.Key, Val>, supportedTypes) {
    return mapRange(op, (o, k) => (
      fieldOps.filterSupportedOps(o, view.get(k), supportedTypes))
    )
  },

  updateResults<Val>(snapshot: I.RangeResult<Val>, _q: I.ReplaceQuery, data: I.RangeResult<Val>[]) {
    if (_q.type !== 'static range') throw new TypeError('Invalid data type in updateResults: ' + _q.type)
    const q = _q.q
  
    // console.log('snap', ins(snapshot), ins(q), ins(data))
    // This is a bit dirty, but on the first updateResults we don't have the
    // result length populated. I'll just fill it in from the other data...
    if (snapshot.length === 0) snapshot.length = q.length
    if (snapshot.length !== q.length || snapshot.length !== data.length) throw new err.InvalidDataError()

    for (let i = 0; i < snapshot.length; i++) {
      let si = snapshot[i], qq = q[i], dd = data[i]
      if (si == null) snapshot[i] = si = []

      // For each qq/dd pair, we need to replace that range in si with the entry in dd.
      if (qq.length !== dd.length) throw new err.InvalidDataError()
      for (let k = 0; k < qq.length; k++) {
        const qqq = qq[i], ddd = dd[i]

        const [start, end] = findRangeStatic(qqq, si.map(x => x[0]))
        if (end < start) throw new err.InvalidDataError() // It might make sense to just skip?
        si.splice(start, end-start, ...ddd)
      }
    }

    return snapshot
  }

  // isStaticRange(q: StaticRange | Range): q is StaticRange {
  //   if ((q as Range).limit) return false
  // },
}

export default type