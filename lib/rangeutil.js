const assert = require('assert')
const rangeops = require('../common/rangeops')

// So, I want this to work against arbitrary sets of values which are
// efficiently packed.
//
// Values must be sorted.
exports.arrayCursor = arrayCursor
function arrayCursor(values) {
  let i = 0

  return {
    skip(k) { // Skip to >= k
      while (i < values.length && values[i] < k) i++
    },

    peek() {
      return i >= values.length ? null : values[i]
    },

    next() { i++ },
  }
}

// Go through the range object and yield each matching object the cursor has, in turn.
exports.eachInRanges2 = eachInRanges2
function eachInRanges2(range, cursor, out, fn) {
  if (Array.isArray(cursor) || typeof cursor === 'string') cursor = arrayCursor(cursor)
  else if (cursor.next && !cursor.skip) cursor = arrayCursor(Array.from(cursor).sort()) // iterators.

  let done = false
  rangeops.forEach(range, (a, rval, b) => {
    if (done || rval <= 0) return

    const a_ = a.slice(1), b_ = b.slice(1), bInclusive = b[0] === '>'
    cursor.skip(a_)
    if (a.slice(0) === '>' && cursor.peek()[0] === a_) cursor.next()

    while (true) {
      const entry = cursor.peek()
      if (entry == null) break

      const [key, val] = entry
      if (key > b_ || (key === b_ && !bInclusive)) break

      if (fn(key, val, rval)) {
        // Early terminate.
        if (out) rangeops.append(out, a, rval, '>'+key)
        done = true
        return
      }
      cursor.next()
    }
    if (out) rangeops.append(out, a, rval, b)
  })

  return out
}

exports.eachInRanges = (range, cursor, fn) => eachInRanges2(range, cursor, null, fn)

/* TODO: Make me into a test.
console.log(exports.eachInRanges2(['<a', 1, '<k', 0, '<m', 1, '>o', 0, '<x', 1, '.'], arrayCursor('abcdefghijklmnop'), [], c => {
  return (c >= 'm')
})) // -> [ '<a', 1, '<k', 0, '<m', 1, '.' ]
*/

exports.addPrefix = function addPrefix(range, prefix) {
  const result = range.slice()
  for (let i = 0; i < range.length; i += 2) {
    if (result[i] !== '.') result[i] = result[i][0] + prefix + result[i].slice(1)
  }
  return result
}

exports.stripPrefix = function stripPrefix(range, prefix) {
  const result = range.slice()
  for (let i = 0; i < range.length; i += 2) {
    if (result[i] !== '.') {
      // Check that the item has the prefix.
      assert(key.indexOf(prefix) === 1) // Probably faster than slicing.
      result[i] = result[i][0] + result[i].slice(1 + prefix.length)
    }
  }
  return result
}

