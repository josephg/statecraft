const assert = require('assert')
const rangeops = require('../common/rangeops')

const identity = x => x

// TODO: These cursors are basically a mess. Rewrite to use node iterators.

// So, I want this to work against arbitrary sets of values which are
// efficiently packed.
//
// Values must be sorted.
exports.arrayCursor = arrayCursor
function arrayCursor(values, getKey = identity) {
  let i = 0

  return {
    skip(k) { // Skip to >= k
      while (i < values.length && getKey(values[i]) < k) i++
    },

    peek() {
      return i >= values.length ? null : [getKey(values[i]), values[i]]
    },

    next() { i++ },
  }
}

// For maps. This is basically identical to the arrayCursor above but ... eh :/
function mapCursor(map) {
  const entries = Array.from(map.entries()).sort()
  let i = 0

  const getVal = () => Array.isArray(current.value) ? current.value[0] : current.value

  return {
    skip(k) { // Skip to >= k
      while (i < entries.length && entries[i][0] < k) i++
    },

    peek() {
      return i >= entries.length ? null : entries[i]
    },

    next() { i++ },
  }
}

// Go through the range object and yield each matching object the cursor has, in turn.
exports.eachInRanges2 = eachInRanges2
function eachInRanges2(range, cursor, out, fn) {
  if (Array.isArray(cursor) || typeof cursor === 'string') cursor = arrayCursor(cursor)
  else if (cursor.constructor === Map) cursor = mapCursor(cursor)

  let done = false
  rangeops.forEach(range, (a, rval, b) => {
    if (done) return

    const a_ = a.slice(1), b_ = b.slice(1), bInclusive = b[0] === '>'
    cursor.skip(a_)
    if (a[0] === '>' && cursor.peek()[0] === a_) cursor.next()

    while (true) {
      const entry = cursor.peek()
      if (entry == null) break

      const [key, val] = entry//Array.isArray(entry) ? entry : [entry, null]
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

