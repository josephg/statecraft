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
    apply([], ['<a', 1, '<b'], ['<a', 1, '<b'])
    apply(['<a', 1, '<b'], ['<a', 1, '<b'], ['<a', 2, '<b'])
    apply(['<a', 1, '<b'], ['<c', 1, '<d'], ['<a', 1, '<b', 0, '<c', 1, '<d'])
    apply(['<a', 1, '<b'], ['<b', 1, '<c'], ['<a', 1, '<c'])

    apply(['<a', 1, '<z'], ['<c', 2, '<d'], ['<a', 1, '<c', 3, '<d', 1, '<z'])
  })

  it('can handle dot keys', () => {
    apply(['<a', 1, '.'], [], ['<a', 1, '.'])
    apply([], ['<a', 1, '.'], ['<a', 1, '.'])
    apply(['<a', 1, '.'], ['>a', 1, '<b'], ['<a', 1, '<b'])
    apply(['<a', 1, '<b'], ['<b', 1, '.'], ['<a', 1, '>b'])
    apply(['<a', 1, '<b'], ['<b', 2, '.'], ['<a', 1, '<b', 2, '.'])
    apply(['<a', 1, '<z'], ['<c', 2, '.'], ['<a', 1, '<c', 3, '.', 1, '<z'])
    apply(['<a', 1, '<b'], ['>b', 2, '<c'], ['<a', 1, '<b', 0, '.', 2, '<c'])
  })


})
