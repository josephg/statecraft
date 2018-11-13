import 'mocha'
import kvmem from '../lib/stores/kvmem'
import augment from '../lib/augment'
import runTests from './common'
import map from '../lib/stores/map'
import splitWrites from '../lib/stores/splitwrites'
import assert from 'assert'

describe('map', () => {
  it('maps simple values', async () => {
    const root = augment(kvmem(new Map([['x', 5]])))
    const store = map(root, x => x + 1)
    const result = await store.fetch({type: 'kv', q: new Set(['x'])})
    assert.strictEqual(result.results.get('x'), 6)
  })

  runTests(() => {
    const store = augment(kvmem())
    const read = map(store, i => i)

    return Promise.resolve(splitWrites(read, store))
  })
})
