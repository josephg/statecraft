const fs = require('fs')
const assert = require('assert')
const withkv = require('./tools/withkv')

function assertMapEq(m1, m2) {
  assert.strictEqual(m1.constructor, Map)
  assert.strictEqual(m2.constructor, Map)

  assert.strictEqual(m1.size, m2.size)
  for (let [k, v] of m1) {
    assert.deepEqual(m2.get(k), v)
  }
}

function test(createStore, teardownStore, prefix, queryWithKeys) {
  // Fetch using fetch() and through subscribe.
  const eachFetchMethod = (store, qtype, query, versions, callback) => {
    assert(store.supportedQueryTypes[qtype],
      `${qtype} queries not supported by store`)

    const [fetch, subscribe] = ({
      kv: [store.fetchKV, store.subscribeKV],
      skv: [store.fetchSKV, store.subscribeSKV],
    })[qtype]

    let fetchresults, subresults

    const check = () => {
      if (fetchresults == null || subresults == null) return

      // For now, just assert that we're up to date everywhere.
      console.log('fr', fetchresults)
      assert.deepEqual(fetchresults.versions, subresults.versions)
      assertMapEq(fetchresults.results, subresults.results)
      callback(null, fetchresults)
    }

    fetch.call(store, query, versions, {}, (err, r) => {
      if (err) return callback(err)
      fetchresults = r
      check()
    })

    const sub = subscribe.call(store, query, versions, {
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

  const assertKVResults = (store, query, expected, callback) => {
    eachFetchMethod(store, 'kv', query, {}, (err, actual) => {
      if (err) throw err
      if (Array.isArray(expected)) expected = new Map(expected)
      assertMapEq(actual.results, expected)
      callback()
    })
  }

  describe('statecraft', () => {
    beforeEach(function() {
      this.store = createStore()
      if (!this.store.supportedQueryTypes.kv) {
        this.store = withkv(this.store)
      }
    })

    afterEach(function() {
      // TODO: And nuke all the contents.
      this.store.close()
    })

    it('returns nothing when fetching a nonexistant document', function(done) {
      assertKVResults(this.store, [], [], done)
    })

    it('can store things and return them', function(done) {
      const txn = new Map([['a', {type:'set', data:'hi there'}]])
      this.store.mutate(txn, {}, {}, (err, v) => {
        if (err) throw err
        assertKVResults(this.store, ['a'], [['a', 'hi there']], done)
      })
    })

    describe('subscribe', () => {

      it('works in raw mode')
      it('can receive create ops')
    })

    describe('fetch', () => {})

    describe('commit', () => {
    
    })

  })
}




const dbroot = require('./lib/dbroot')

const rmdir = (path) => {
  //console.log('rmdir path', path)
  require('child_process').exec('rm -r ' + path)
}

const pathOfDb = new Map
let _dbid = 1
test(
  () => {
    let path
    do {
      path = __dirname + '/_test' + _dbid++
    } while (fs.existsSync(path))

    const store = dbroot(path, {})
    pathOfDb.set(store, path)
    return store
  },
  (store) => { // teardown. Nuke it.
    store.close()
    const path = pathOfDb.get(store)
    rmdir(path)
    pathOfDb.delete(store)
  }
)

process.on('exit', function() {
  for (let p of pathOfDb.values()) {
    rmdir(p)
  }
})

