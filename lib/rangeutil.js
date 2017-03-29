const assert = require('assert')
const rangeops = require('../common/rangeops')

module.exports = {arrayCursor, eachInRanges, addPrefix, stripPrefix}

// So, I want this to work against arbitrary sets of values which are
// efficiently packed.
//
// Values must be sorted.
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
function eachInRanges(range, cursor, fn) {
  if (Array.isArray(cursor) || typeof cursor === 'string') cursor = arrayCursor(cursor)
  else if (cursor.next && !cursor.skip) cursor = arrayCursor(Array.from(cursor).sort()) // iterators.

  rangeops.forEach(range, (a, val, b) => {
    const a_ = a.slice(1), b_ = b.slice(1), bInclusive = b[0] === '>'
    cursor.skip(a_)
    if (a.slice(0) === '>' && cursor.peek()[0] === a_) cursor.next()

    let entry
    while ((entry = cursor.peek()) != null) {
      if (entry[0] > b_ || entry[0] === b_ && !bInclusive) break
      fn(entry, val)
      cursor.next()
    }
  })
}

function addPrefix(range, prefix) {
  const result = range.slice()
  for (let i = 0; i < range.length; i += 2) {
    if (result[i] !== '.') result[i] = result[i][0] + prefix + result[i].slice(1)
  }
  return result
}

function stripPrefix(range, prefix) {
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

