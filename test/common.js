const assert = require('assert6') // Once node 8 is out we can go back to the old version.
const eachAsync = require('each-async')

const withkv = require('../lib/withkv')
const easyapi = require('../lib/easyapi')
const resultset = require('../lib/resultset')

const rangeops = require('../common/rangeops')

const {assertMapEq} = require('./util')

const trimVersions = (vs) => {
  const result = {}
  for (const k in vs) if (k[0] !== '_') result[k] = vs[k]
  return result
}

const setOp = (val) => ({type: 'set', data: val})

// Consider moving this to ./util
const assertResultsEqual = (actual, {results:expectedVal, versions:expectedVer}) => {
  if (Array.isArray(expectedVal)) expectedVal = new Map(expectedVal)

  // Check value
  assertMapEq(actual.results, expectedVal)

  // Check version
  for (let source in expectedVer) {
    let expectv = expectedVer[source]
    if (!Array.isArray(expectv)) expectv = [expectv, expectv]

    // We sort of just want to check that the version returned is contained
    // within expectedVer.
    actualv = actual.versions[source]
    assert(actualv)
    assert.strictEqual(actualv[0], expectv[0])
    //console.log('ev', expectv, 'av', actualv)
    assert.strictEqual(actualv[1], expectv[1])
  }
}

module.exports = function test(createStore, teardownStore, prefix, queryWithKeys) {
  // Fetch using fetch() and through subscribe.
  const eachFetchMethod = (store, qtype, query, versions, callback) => {
    assert(store.capabilities.queryTypes.has(qtype),
      `${qtype} queries not supported by store`)

    let fetchresults, subresults1, subresults2

    const check = () => {
      if (fetchresults == null || subresults1 == null) return

      try {
        // For now, just assert that we're up to date everywhere.
        //console.log('fr', fetchresults)
        assert.deepEqual(fetchresults.versions, subresults1.versions)
        assert.deepEqual(fetchresults.versions, subresults2.versions)
        //assert.deepEqual(fetchresults.versions, subresults2.versions)

        //console.error('fr', fetchresults, '\nsr', subresults1)
        assertMapEq(fetchresults.results, subresults1.results)
        assertMapEq(fetchresults.results, subresults2.results)
      } catch (e) {
        console.error('Results do not match', qtype)
        console.error('fetch results:', fetchresults)
        console.error('subscribe data', subresults1)
        console.error('data sent to subscribe listener', subresults2)
        return callback(e)
      }

      callback(null, fetchresults)
    }

    store.fetch(qtype, query, {atVersions: versions}, (err, r) => {
      if (err) return callback(err)
      fetchresults = {results: r.results, versions: r.versions}
      check()
    })

    subresults2 = {versions:{}, results:new Map}
    const listener = (type, update, versionUpd) => {
      resultset.applyMut(subresults2.results, update)
      for (const s in versionUpd) {
        if (s[0] !== '_') subresults2.versions[s] = versionUpd[s]
      }
      //console.log('->', subresults2.results)

      // TODO: How should I be passing back result versions?
      //if (source) subresults2.versions[source] = [version, version]
    }

    const sub = store.trackingSub(qtype, query, versions, {
      supportedTypes: [], // Make sure the listener gets passed sets.
    }, listener)
    sub.cursorAll(err => {
      if (err) return callback(err)
      subresults1 = {results: sub.data, versions: trimVersions(sub.versions)}
      sub.cancel()
      check()
    })
  }

  const fetchEachQType = (store, keys, versions, callback) => {
    if (typeof versions === 'function') [versions, callback] = [{}, versions]

    assert(store.capabilities.queryTypes.has('kv') || store.capabilities.queryTypes.has('sortedkv'))

    let results = null
    eachAsync(['kv', 'sortedkv'], (qtype, i, done) => {
      if (!store.capabilities.queryTypes.has(qtype)) return done()

      const q = ({
        kv: keys => keys,
        sortedkv: keys => rangeops.fromKeys(keys),
      })[qtype](keys)
      eachFetchMethod(store, qtype, q, versions, (err, r) => {
        if (err) return done(err)

        if (results == null) results = r
        else assertResultsEqual(results, r)
        done()
      })
    }, err => callback(err, results))
  }

  const assertKVResults = (store, keys, expectedVals, expectedVer, callback) => {
    fetchEachQType(store, keys, {}, (err, results) => {
      if (err) return callback(err)

      assertResultsEqual(results, {results:expectedVals, versions:expectedVer})
      callback()
    })
  }

  // Convert from a version object with 1 entry to a [source, version] pair
  const splitSingleVersions = (versions) => {
    const sources = Object.keys(versions)
    assert.strictEqual(sources.length, 1)
    const source = sources[0]
    return [source, versions[source]]
  }

  const setSingle = (store, key, value, versions, callback) => {
    if (typeof versions === 'function') [versions, callback] = [{}, versions]
    store.set(key, value, versions, (err, vs) => {
      if (err) return callback(err)
      const [source, version] = splitSingleVersions(vs)
      callback(null, source, version)
    })
  }

  const delSingle = (store, key, versions, callback) => {
    if (typeof versions === 'function') [versions, callback] = [{}, versions]
    store.delete(key, versions, (err, vs) => {
      if (err) return callback(err)
      const [source, version] = splitSingleVersions(vs)
      callback(null, source, version)
    })
  }

  const get = (store, key, opts, callback) => {
    if (typeof opts === 'function') [opts, callback] = [{}, opts]
    store.fetch('kv', [key], opts, (err, data) => {
      if (err) return callback(err)

      const {results, versions} = data
      // Results must contain either 0 or 1 items.
      assert(results.size <= 1)
      callback(null, results.entries().next().value || null, ...splitSingleVersions(versions))
    })
  }

  const getVersionForKeys = (store, keys, callback) => {
    if (!Array.isArray(keys)) keys = [keys]
    // TODO: Set options to elide actual data in response
    store.fetch('kv', keys, {}, (err, data) => {
      if (err) return callback(err)
      else callback(null, ...splitSingleVersions(data.versions))
    })
  }

  const asAsync = fn => fn.length === 1 ? fn : cb => cb(null, fn())

  describe('common tests', () => {
    beforeEach(function(done) {
      asAsync(createStore)((err, store) => {
        if (err) throw err
        this.rawStore = store
        this.store = easyapi(withkv(store))
        done()
      })
    })

    afterEach(function() {
      // TODO: And nuke all the contents.
      this.store.close()
      if (teardownStore) teardownStore(this.rawStore)
    })

    // Some simple sanity tests
    it('returns nothing when running an empty query', function(done) {
      assertKVResults(this.store, [], [], null, done)
    })

    it('returns nothing when fetching a nonexistant document', function(done) {
      assertKVResults(this.store, ['doesnotexist'], [], null, done)
    })

    it('can store things and return them', function(done) {
      const txn = new Map([['a', {type:'set', data:'hi there'}]])
      this.store.mutate(txn, {}, {}, (err, vs) => {
        if (err) throw err

        // The version we get back here should contain exactly 1 source with a
        // single integer version.
        assert.strictEqual(Object.keys(vs).length, 1)
        assert.strictEqual(typeof Object.values(vs)[0], 'number')

        assertKVResults(this.store, ['a'], [['a', 'hi there']], vs, done)
      })
    })

    it('allows you to delete a key', function(done) {
      setSingle(this.store, 'a', 1, (err, s, v1) => {
        if (err) throw err

        delSingle(this.store, 'a', (err, s, v2) => {
          if (err) throw err
          assert(v2 > v1)

          get(this.store, 'a', (err, value, s, v3s) => {
            if (err) throw err
            assert.equal(value, null)
            assert.strictEqual(v2, v3s[1])
            done()
          })
        })
      })
    })

    it('allows you to delete a nonexistant key', function(done) {
      delSingle(this.store, 'a', (err, s, v1) => {
        if (err) throw err
        get(this.store, 'a', (err, value, s, v2s) => {
          if (err) throw err
          assert.equal(value, null)
          assert.strictEqual(v1, v2s[1])
          done()
        })
      })
    })

    // This test relies on the full version semantics of statecraft's native stores.
    it('returns acceptable version ranges for queries', function(done) {
      // Set in 3 different transactions so we get a document version range.
      setSingle(this.store, 'a', 1, (err, source, v1) => {
        if (err) throw err
        setSingle(this.store, 'b', 2, (err, source, v2) => {
          if (err) throw err
          setSingle(this.store, 'c', 3, (err, source, v3) => {
            if (err) throw err
            assert(v1 < v2 && v2 < v3)
            assertKVResults(this.store, ['a'], [['a', 1]], {[source]: [v1, v3]}, done)
          })
        })
      })
    })

    it('makes conflicting edits to the same key collide', function(done) {
      // TODO: Make a parallel version of this function.
      getVersionForKeys(this.store, 'a', (err, source, vrange) => {
        if (err) throw err
        const v = vrange[1]

        // Now set it. This should succeed...
        setSingle(this.store, 'a', 1, {[source]:v}, (err) => {
          if (err) throw err

          // ... Then 'concurrently' set it again.
          setSingle(this.store, 'a', 2, {[source]:v}, (err) => {
            // TODO: Check that the error type is a write conflict.
            assert(err)
            done()
          })
        })
      })
    })

    it('allows concurrent edits to different keys', function(done) {
      getVersionForKeys(this.store, ['a', 'b'], (err, source, vrange) => {
        if (err) throw err
        const v = vrange[1]
        setSingle(this.store, 'a', 1, {[source]:v}, (err) => {
         if (err) throw err

          // TODO: Make a parallel variant of this function
          setSingle(this.store, 'b', 1, {[source]:v}, (err) => {
            if (err) throw err
            done()
          })
        })
      })
    })

    describe('ot tests', function() {
    })

    it('supports opts.noDocs in fetch', function(done) {
      setSingle(this.store, 'a', {some:'big object'}, (err, source, v1) => {
        if (err) throw err
        get(this.store, 'a', {noDocs:true}, (err, value, s, v2s) => {
          if (err) throw err
          assert.strictEqual(value[0], 'a') // This testing api sucks.
          assert(value[1] === true || value[1] === 1)
          assert(v2s[1] === v1)
          done()
        })
      })
    })

    describe('limits', () => {
      // limits are advisory only. We'll check for conformance and if it fails
      // we'll mark the test as skipped.
      beforeEach(function(done) {
        const txn = new Map([
          ['a', {type:'set', data:'a data'}],
          ['b', {type:'set', data:'b data'}],
          ['c', {type:'set', data:'c data'}],
          ['d', {type:'set', data:'d data'}],
        ])
        this.store.mutate(txn, {}, {}, (err, vs) => done(err))
      })

      it('supports doc limits in fetch', function(done) {
        eachAsync([1,2,3,4], (limit, _, done) => {
          this.store.fetch('kv', ['a', 'b', 'c', 'd'], {limitDocs:limit}, (err, results) => {
            if (err) throw err

            // TODO: Check results.queryRun as well.
            if (results.results.size !== limit) done(Error('Limit not respected'))
            else done()
          })
        }, err => {
          if (err && err.message === 'Limit not respected') return this.skip()
          else done()
        })
      })

      it('supports byte limits in fetch', function(done) {
        this.store.fetch('kv', ['a', 'b', 'c', 'd'], {limitBytes: 1}, (err, results) => {
          if (err) throw err

          // TODO: also check results.queryRun

          if (results.results.size !== 1) return this.skip()
          done()
        })
      })
    })

    it('supports conflicting read keys') // but NYI.

    describe('skv', () => {
      it('supports subscribing to a range')
      it('includes deleted documents in version information')
      it('supports skip and limit') // ??? TODO
    })

    describe('getOps', () => {
      beforeEach(function(done) {
        // Setting these in a series of operations so we have something to query over.
        setSingle(this.store, 'a', 1, (err, source, v1) => {
          if (err) throw err
          this.source = source
          this.v1 = v1

          setSingle(this.store, 'b', 2, (err, source, v2) => {
            if (err) throw err
            this.v2 = v2
            setSingle(this.store, 'a', 3, (err, source, v3) => {
              if (err) throw err
              this.v3 = v3
              setSingle(this.store, 'b', 4, (err, source, v4) => {
                if (err) throw err
                this.v4 = v4

                this.expectedOps = [
                  {source:this.source, v:this.v1, meta:{ts:0}, txn:new Map([['a', {type:'set', data:1}]])},
                  {source:this.source, v:this.v2, meta:{ts:0}, txn:new Map([['b', {type:'set', data:2}]])},
                  {source:this.source, v:this.v3, meta:{ts:0}, txn:new Map([['a', {type:'set', data:3}]])},
                  {source:this.source, v:this.v4, meta:{ts:0}, txn:new Map([['b', {type:'set', data:4}]])},
                ]
                done()
              })
            })
          })
        })
      })

      const cleanTs = (ops) => ops.forEach(
        op => { if (op.meta && op.meta.ts) op.meta.ts = 0 }
      )
      
      // TODO: Write wrapper to call getOps through both sortedkv and kv

      it('returns an empty list when no versions are requested', function(done) {
        this.store.getOps('kv', ['a', 'b', 'c', 'd'], {}, {}, (err, ops) => {
          if (err) throw err
          assert.deepStrictEqual(ops, [])
          done()
        })
      })

      it('returns an empty list for closed ranges', function(done) {
        this.store.getOps('kv', ['a', 'b', 'c', 'd'], {[this.source]: [this.v1, this.v1]}, {}, (err, ops) => {
          if (err) throw err
          assert.deepStrictEqual(ops, [])
          done()
        })
      })

      it('returns operations in specified range', function(done) {
        this.store.getOps('kv', ['a', 'b'], {[this.source]: [this.v1-1, this.v4]}, {}, (err, ops) => {
          if (err) throw err
          cleanTs(ops)
          assert.deepStrictEqual(ops, this.expectedOps)
          done()
        })
      })

      it('filters operations by query', function(done) {
        this.store.getOps('kv', ['a'], {[this.source]: [this.v1-1, this.v4]}, {}, (err, ops) => {
          if (err) throw err
          cleanTs(ops)
          assert.deepStrictEqual(ops, [this.expectedOps[0], this.expectedOps[2]])
          done()
        })
      })

      it('filters returned txn entries by the query', function(done) {
        const txn = new Map([
          ['a', {type:'set', data:5}],
          ['b', {type:'set', data:6}],
          ['c', {type:'set', data:7}],
        ])
        this.store.mutate(txn, {}, {}, (err, sv5) => {
          if (err) throw err
          const [_, v5] = splitSingleVersions(sv5)

          this.store.getOps('kv', ['a', 'b'], {[this.source]: [this.v4, v5]}, {}, (err, ops) => {
            if (err) throw err
            cleanTs(ops)
            assert.deepStrictEqual(ops, [
              {source:this.source, v:v5, meta:{ts:0}, txn:new Map([
                ['a', {type:'set', data:5}],
                ['b', {type:'set', data:6}] // But c is missing because we didn't ask for it.
              ])},
            ])
            done()
          })
        })
      })

      it('returns all operations if the upper range is -1', function(done) {
        this.store.getOps('kv', ['a', 'b'], {[this.source]: [this.v1-1, -1]}, {}, (err, ops) => {
          if (err) throw err
          cleanTs(ops)
          assert.deepStrictEqual(ops, this.expectedOps)
          done()
        })
      })

      // Should it wait? Should it return what it can? Should it be based on the options? ???
      it('acts in [unspecified way] when the range contains future versions')

    })

    describe('subscribe', () => {
      // TODO: Make this subscribe using both methods.
      const subscribeKV = (store, query, versions, opts, listener) => store.subscribe('kv', query, versions, opts, listener)

      const listenerCheck = (expectedValues, done) => {
        let pos = 0
        return (type, update, versionUpdate, sub) => {
          //console.log('listener hit with', type, update, versionUpdate, 'complete', sub.isComplete(), expectedValues[pos])

          assert(pos < expectedValues.length)
          let expected = expectedValues[pos]

          if (expected.type) assert.deepStrictEqual(type, expected.type)
          if (expected.update) assert.deepStrictEqual(update, new Map(expected.update))
          if (expected.versions) for (const s in expected.versions) {
            assert.deepStrictEqual(versionUpdate[s], expected.versions[s])
          }
          if (expected.complete != null) assert.strictEqual(sub.isComplete(), expected.complete)

          pos++
          if (pos === expectedValues.length) {
            sub.cancel()
            done()
          }

          if (expected.poll) sub.cursorNext()
        }
      }

      it('can fetch requested keys', function(done) {
        setSingle(this.store, 'a', 1, (err, source, v1) => {
          if (err) throw err

          const sub = subscribeKV(this.store, ['a'], {}, {limitDocs:1}, listenerCheck([
            {update: [['a', setOp(1)]], versions: {[source]: [v1, v1]}, complete: true}
          ], done))

          sub.cursorNext()
        })
      })

      it('gets operations on subscribed fields', function(done) {
        let called = false

        const sub = subscribeKV(this.store, ['a'], {}, {limitDocs:1}, listenerCheck([
          {update: [], complete:true},
          {update: [['a', setOp('hi')]], complete:true},
        ], done))

        sub.cursorNext({}, (err) => {
          if (err) throw err
          setSingle(this.store, 'a', 'hi')
        })
      })

      describe('modifying subscriptions', () => {
        beforeEach(function(done) {
          // Setting these in a series of operations so we have something to query over.
          setSingle(this.store, 'a', 'aa', (err, source, v1) => {
            if (err) throw err
            this.source = source
            this.v1 = v1

            setSingle(this.store, 'b', 'bb', (err, source, v2) => {
              if (err) throw err
              this.v2 = v2
              done()
            })
          })
        })

        it('allows modifying the query after the data has been read', function(done) {
          const sub = subscribeKV(this.store, ['a'], {}, {limitDocs:1}, listenerCheck([
            {update: [['a', setOp('aa')]], complete: true},
            {type: 'modify', versions: {_query: [10, 10]}, complete: false, poll:true},
            {update: [['b', setOp('bb')]], complete: true},
          ], done))

          sub.cursorNext({}, err => {
            if (err) throw err
            // We should have gotten the first update now. Lets modify the query...
            sub.modify({remove:['a'], add:['b']}, 10)
          })
        })

        it('allows modifying the query before its read any data', function(done) {
          const sub = subscribeKV(this.store, ['a'], {}, {limitDocs:1}, listenerCheck([
            {update: [], complete: false, poll:true}, // Hit by the modify
            {update: [['b', setOp('bb')]], complete: true},
          ], done))

          process.nextTick(() => {
            // Without even hitting the cursor we'll modify the query.
            sub.modify({remove:['a'], add:['b']})
          })
        })
      })

      it('removes keys from the cursor when the sub is modified')
      it('sends cursor updates if opts.trackCursor is set')
      it('does not fetch if noFetch flag is passed')

      it('can hold until a future version is specified')
      it('can receive create ops')
      it('allows editing the query')

    })

    describe('fetch', () => {})

    describe('commit', () => {
    
    })

  })
}



