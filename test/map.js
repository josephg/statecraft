const map = require('../lib/map')
const assert = require('assert')

describe('map', () => {
  it('maps fetch results')
  it('maps subscribe results')
  
  {
    const {create: createLmdb, close: closeLmdb} = require('./lmdb')
    const runTests = require('./common')
    describe('through an identity function', () => {
      runTests(() => {
        const inner = createLmdb()
        return map(inner, x => x)
      }, closeLmdb)
    })
  }

})

