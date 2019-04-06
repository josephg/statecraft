import * as I from '../lib/interfaces'
import 'mocha'
import kvmem from '../lib/stores/kvmem'
import runTests from './common'
import map from '../lib/stores/map'
import splitWrites from '../lib/stores/splitwrites'
import assert from 'assert'
import { setKV } from '../lib/kv';

describe('map', () => {
  it('maps simple values', async () => {
    const root = await kvmem<number>()
    const v = await setKV(root, 'x', 5)

    const store = map(root, x => x + 1)
    const result = await store.fetch({type: I.QueryType.KV, q: new Set(['x'])}, {minVersion: v})
    assert.strictEqual(result.results.get('x'), 6)
  })

  runTests(async () => {
    const store = await kvmem()
    const read = map(store, i => i)

    return splitWrites(read, store)
  })
})
