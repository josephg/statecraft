const assert = require('assert')
const type = require('./rangeops')

describe('rangeops', () => {
  const apply = (a, b, expected) => {
    const result = type.apply(a, b)
    assert.deepEqual(result, expected)
  }

  it('can apply', () => {
    apply([], [], [])
    apply(['<a', 1, '<b'], [], ['<a', 1, '<b'])
    apply(['<a', 1, '<b'], ['<a', 1, '<b'], ['<a', 2, '<b'])
    apply(['<a', 1, '<b'], ['<c', 1, '<d'], ['<a', 1, '<b', 0, '<c', 1, '<d'])
    apply(['<a', 1, '<b'], ['<b', 1, '<c'], ['<a', 1, '<c'])
  })


})
