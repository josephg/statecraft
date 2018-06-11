import 'mocha'
import kvmem from '../lib/stores/kvmem'
import augment from '../lib/augment'
import runTests from './common'
import map from '../lib/stores/map'
import splitWrites from '../lib/stores/splitwrites'

describe('kvmem', () => {
  runTests(() => {
    const store = augment(kvmem())
    const read = map(store, i => i)

    return Promise.resolve(splitWrites(read, store))
  })
})
