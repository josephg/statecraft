import 'mocha'
import kvmem from '../lib/stores/kvmem'
import augment from '../lib/augment'
import runTests from './common'


describe('kvmem', () => {
  runTests(() => Promise.resolve(augment(kvmem())))
})