const rangeops = require('./rangeops')

module.exports = {arrayCursor, eachInRanges}

// So, I want this to work against arbitrary sets of values which are
// efficiently packed.
//
// Values must be sorted.
function arrayCursor(values) {
  let i = 0

  return {
    skip(k) {
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
  rangeops.forEach(range, (a, val, b) => {
    console.log(a, val, b)
    const a_ = a.slice(1), b_ = b.slice(1), bInclusive = b[0] === '>'
    cursor.skip(a_)
    if (a.slice(0) === '>' && cursor.peek() === a_) cursor.next()

    let k
    while ((k = cursor.peek()) != null) {
      console.log('k', k, 'b_', b_, 'kinc', bInclusive)
      if (k > b_ || k === b_ && !bInclusive) break
      fn(k, val)
      cursor.next()
    }
  })
}


