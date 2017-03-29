const assert = require('assert')
const withkv = require('../lib/withkv')
const easyapi = require('../lib/easyapi')

const {assertMapEq} = require('./util')

module.exports = function test(createStore, teardownStore, prefix, queryWithKeys) {
  // Fetch using fetch() and through subscribe.
  const eachFetchMethod = (store, qtype, query, versions, callback) => {
    assert(store.supportedQueryTypes[qtype],
      `${qtype} queries not supported by store`)

    let fetchresults, subresults

    const check = () => {
      if (fetchresults == null || subresults == null) return

      // For now, just assert that we're up to date everywhere.
      //console.log('fr', fetchresults)
      assert.deepEqual(fetchresults.versions, subresults.versions)
      //console.error('fr', fetchresults, '\nsr', subresults)
      assertMapEq(fetchresults.results, subresults.results)
      callback(null, fetchresults)
    }

    store.fetch(qtype, query, versions, {}, (err, r) => {
      if (err) return callback(err)
      fetchresults = r
      check()
    })

    const sub = store.subscribe(qtype, query, versions, {
      raw: false,
      // initialFetch: true,
    }, () => {}, (err, cv) => {
      if (err) return callback(err)
      const versions = Object.assign({}, sub.versions)
      delete versions._client
      subresults = {results: sub.data, versions}
      sub.cancel()
      check()
    })
  }

  const assertKVResults = (store, query, expectedVal, expectedVer = {}, callback) => {
    // TODO: Make this function convert the query to other types (SVK) as well
    // and test those APIs directly.

    //const query = queryNoPrefix.map(x => `${prefix}x`)
    eachFetchMethod(store, 'kv', query, {}, (err, actual) => {
      if (err) throw err

      // Check value
      if (Array.isArray(expectedVal)) expectedVal = new Map(expectedVal)
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

  const get = (store, key, callback) => {
    store.fetch('kv', [key], {}, {}, (err, data) => {
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
    store.fetch('kv', keys, {}, {}, (err, data) => {
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
    it('returns nothing when fetching a nonexistant document', function(done) {
      assertKVResults(this.store, [], [], null, done)
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

    it('allows you to delete a key')

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

    /*
    describe('ot tests', function() {
      return
      it('asdf')

    })*/

    it('supports conflicting read keys')

    describe('skv', () => {
      it('supports subscribing to a range')
      it('includes deleted documents in version information')
      it('supports skip and limit') // ??? TODO
    })

    describe('subscribe', () => {

      it('returns data when not in raw mode')
      it('can hold until a future version is specified')
      it('can receive create ops')
      it('allows editing the query')

    })

    describe('fetch', () => {})

    describe('commit', () => {
    
    })

  })
}


