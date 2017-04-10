const lens = require('../lib/lens')
const assert = require('assert')
const {assertMapEq} = require('./util')

describe('lens', () => {
  describe('lens specific tests', () => {
    beforeEach(function() {
      // Just using a stub. TODO: Replace me with a memory store or something.
      this.store = {
        capabilities: {
          mutationTypes: new Set(['kv', 'othermutation']),
          opTypes: new Set(['otherop']),
          queryTypes: new Set(['kv', 'sortedkv']),
        }
      }

      this.lens = lens(this.store, 'x/')
    })

    it('filters capabilities')

    describe('fetch', () => {
      it('correctly scopes in kv queries', function(done) {
        const opts = {}
        this.store.fetch = (qtype, query, opts, callback) => {
          assert.strictEqual(qtype, 'kv')
          assert.deepEqual(query, ['x/a', 'x/b']) // TODO: Also ok to get a set here.
          assert.strictEqual(opts, opts)

          callback(null, {
            results: new Map([['x/a', 5], ['x/b', 7]]),
            versions: {}
          })

        }

        this.lens.fetch('kv', ['a', 'b'], opts, (err, {results, versions}) => {
          if (err) throw err
          assert.deepEqual(results, new Map([['a', 5], ['b', 7]]))
          done()
        })
      })

      it('correctly scopes in skv queries', function(done) {
        const opts = {}
        this.store.fetch = (qtype, query, opts, callback) => {
          assert.strictEqual(qtype, 'sortedkv')
          assert.deepEqual(query, ['<x/a', 1, '.', 0, '>x/b', 1, '>x/c'])
          assert.strictEqual(opts, opts)

          callback(null, {
            results: new Map([['x/a', 5], ['x/c', 7]]),
            versions: {}
          })

        }

        this.lens.fetch('sortedkv', ['<a', 1, '.', 0, '>b', 1, '>c'], opts, (err, {results, versions}) => {
          if (err) throw err
          assert.deepEqual(results, new Map([['a', 5], ['c', 7]]))
          done()
        })
      })

      it('errors when encountering another kind of query')
      it('errors if the database returns results outside of the expected range') // TODO: Or should it discard outside values?
    })

    describe('subscribe', () => {
    })
  })

  {
    const {create: createLmdb, close: closeLmdb} = require('./lmdb')
    const runTests = require('./common')
    runTests(() => {
      const inner = createLmdb()
      return lens(inner, 'x/')
    }, closeLmdb)
  }
})
