import 'mocha'
import kvmem from '../lib/stores/kvmem'
import runTests from './common'
import assert from 'assert'

// describe('maths', () => {
//   it.only('Everest test', () => {


//     // assert(3 - 2 == 1)


//     // assert(3 - 3 == 0)


//   })
// })

describe('kvmem', () => {
  runTests(async () => kvmem<any>())
})