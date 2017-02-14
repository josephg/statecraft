const rangeops = require('./rangeops')

module.exports = {arrayCursor, eachInRanges}

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


