const map = require('../lib/map')
const assert = require('assert')

describe('map', () => {
  describe('', function() {
    beforeEach(function() {
      // Just using a stub. TODO: Replace me with a memory store or something.
      this.store = {
        supportedQueryTypes: {kv:true},
        fetch(qtype, query, opts, callback) {
          const results = new Map
          if (query.has('obj')) results.set('obj', opts.noDocs ? 1 : {x:5})
          if (query.has('str')) results.set('str', opts.noDocs ? 1 : 'hi there')

          return callback(null, {results, versions:{testsource:[1,1]}, queryRun:query})
        },
      }

      this.mappingFn = (v, k) => v
      this.mapped = map(this.store, (v, k) => this.mappingFn(v, k))
    })

    it('maps fetch results', function(done) {
      this.mappingFn = (v, k) => {
        // Won't be called for nonexistant objects.
        assert.strictEqual(k, 'obj')
        assert.deepStrictEqual(v, {x:5})

        return {y:7}
      }

      this.mapped.fetch('kv', new Set(['obj', 'doesnotexist']), {}, (err, data) => {
        if (err) throw err
        const {results} = data
        assert.deepStrictEqual(results.get('obj'), {y:7})
        assert.equal(results.get('doesnotexist'), null)

        done()
      })
    })

    it('works with empty results')
    it('respects noDocs option', function(done) {
      this.mappingFn = () => {throw Error('should not be called')}

      this.mapped.fetch('kv', new Set(['obj', 'doesnotexist']), {noDocs:true}, (err, data) => {
        if (err) throw err
        const {results} = data
        assert.strictEqual(results.get('obj'), 1)
        assert.equal(results.get('doesnotexist'), null)
        done()
      })
      
    })

    it('maps subscribe results')
    it('flattens operations through subscription')

    it('flattens operations through getOps')
  })
  
  {
    // TODO: Rewrite me to use the memory store when we have it
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

