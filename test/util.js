const assert = require('assert')

module.exports = {assertMapEq}

function assertMapEq(m1, m2) {
  assert.strictEqual(m1.constructor, Map, 'm1 not a map')
  assert.strictEqual(m2.constructor, Map, 'm2 not a map')

  assert.strictEqual(m1.size, m2.size, 'map sizes do not match')
  for (let [k, v] of m1) {
    assert.deepEqual(m2.get(k), v)
  }
}
