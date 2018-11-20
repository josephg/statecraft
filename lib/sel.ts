import {StaticKeySelector as Sel, Key} from './interfaces'

const sel = (k: Key, isAfter: boolean = false): Sel => ({k, isAfter})

// A selector and a key can never be equal.
const kLtSel = sel.kLt = (k: Key, s: Sel) => k < s.k || (k === s.k && s.isAfter)
sel.kGt = (k: Key, s: Sel) => !kLtSel(k, s)

const selLtSel = sel.ltSel = (a: Sel, b: Sel) => a.k < b.k || (!a.isAfter && b.isAfter)
const selGtSel = sel.gtSel = (a: Sel, b: Sel) => selLtSel(b, a)
sel.LtESel = (a: Sel, b: Sel) => !selGtSel(a, b)
sel.GtESel = (a: Sel, b: Sel) => !selLtSel(a, b)

const minSel = sel.min = (a: Sel, b: Sel): Sel => (
  (a.k < b.k) ? a
    : (a.k > b.k) ? b
    : {k: a.k, isAfter: a.isAfter && b.isAfter}
)
const maxSel = sel.max = (a: Sel, b: Sel): Sel => (
  (a.k > b.k) ? a
    : (a.k < b.k) ? b
    : {k: a.k, isAfter: a.isAfter || b.isAfter}
)

sel.intersect = (as: Sel, ae: Sel, bs: Sel, be: Sel): [Sel, Sel] | null => {
  const start = maxSel(as, bs)
  const end = minSel(ae, be)
  return selLtSel(end, start) ? null : [start, end]
}

sel.prefix = (prefix: string, s: Sel): Sel => ({k: prefix + s.k, isAfter: s.isAfter})

export default sel