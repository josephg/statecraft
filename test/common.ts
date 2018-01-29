import * as I from '../lib/types/interfaces'
import 'mocha'
import assert = require('assert')
import {queryTypes} from '../lib/types/queryops'

const assertThrows = async (block: () => Promise<void>, errType?: string) => {
  try {
    await block()
  } catch (e) {
    if (errType) assert.strictEqual(e.type, errType)
    return
  }
  throw Error('Block did not throw')
}

const fetchP = (store: I.Store, qtype: I.QueryType, query: any, opts: I.FetchOpts): Promise<I.FetchResults> =>
  new Promise((resolve, reject) => {
    store.fetch(qtype, query, opts, (err, results) => {
      if (err) reject(err)
      else resolve(results)
    })
  })

const mutateP = (store: I.Store, type: I.ResultType, txn: I.Txn, versions: I.FullVersion, opts: I.MutateOptions): Promise<I.FullVersion> =>
  new Promise((resolve, reject) => {
    store.mutate(type, txn, versions, opts, (err, versions) => {
      if (err) return reject(err)
      else resolve(versions)
    })
  })

const getOpsP = (store: I.Store, qtype: I.QueryType, query: any, versions: I.FullVersionRange, opts: I.GetOpsOptions): Promise<I.GetOpsResult> =>
  new Promise((resolve, reject) => {
    store.getOps(qtype, query, versions, opts, (err, results) => {
      if (err) return reject(err)
      else resolve(results!)
    })
  })

type SimpleResult = {
  results: any,
  versions: I.FullVersionRange,
}

const rangeContainsVersion = (range: I.VersionRange, v: I.Version) => v >= range.from && v <= range.to
const rangeContainsRange = (r1: I.VersionRange, r2: I.VersionRange) => r1.from <= r2.from && r1.to >= r2.to
const rangeContainsV = (range: I.VersionRange, v: I.Version | I.VersionRange) =>
  typeof v === 'number' ? rangeContainsVersion(range, v) : rangeContainsRange(range, v)
const versionAtLeast = (v1: I.Version, v2: I.Version | I.VersionRange) =>
  typeof v2 === 'number' ? v2 >= v1 : v2.from >= v1
const versionSatisfies = (v1: I.Version | I.VersionRange, v2: I.Version | I.VersionRange) =>
  typeof v1 === 'number' ? versionAtLeast(v1, v2) : rangeContainsV(v1, v2)

const fullVersionSatisfies = (r1: I.FullVersion | I.FullVersionRange, r2: I.FullVersion | I.FullVersionRange) => {
  for (let source in r1) {
    const rs = r2[source]
    if (rs !== null && !versionSatisfies(r1[source], rs)) return false
  }
  return true
}

const assertEqualResults = (actual: SimpleResult, expected: SimpleResult, strictVersionCheck: boolean = true) => {
  // assert.deepStrictEqual(actual.versions, expected.versions)
  if (strictVersionCheck) assert.deepStrictEqual(actual.versions, expected.versions)
  else assert(fullVersionSatisfies(expected.versions, actual.versions))

  assert.deepStrictEqual(actual.results, expected.results)
}

// Fetch using fetch() and through subscribe.
const eachFetchMethod = async (store: I.Store, qtype: I.QueryType, query: any): Promise<SimpleResult> => {
  assert(store.capabilities.queryTypes.has(qtype),
    `${qtype} queries not supported by store`)

  const results: SimpleResult[] = await Promise.all([
    fetchP(store, qtype, query, {}).then(({results, versions}) => ({results, versions})),
    new Promise<SimpleResult>((resolve, reject) => {
      const rtype = queryTypes[qtype].r
      let r: any = rtype.create()

      const sub = store.subscribe(qtype, query, {supportedTypes: new Set()}, (updates, resultingVersion, _s) => {
        assert.strictEqual(sub, _s)
        // console.log('subscribe listener')
        if (updates.type === 'txns') {
          updates.txns.forEach(txn => rtype.applyMut!(r, txn.txn))
        } else {
          assert.strictEqual(updates.type, 'aggregate')
          rtype.applyMut!(r, updates.txn)
        }

        // TODO: And update the versions?
      })

      sub.cursorAll(null, (err, status) => {
        if (err) return reject(err)

        const {activeQuery, activeVersions} = status!
        assert.deepStrictEqual(activeQuery, query)
        resolve({results: r, versions: activeVersions})
      })
    })
  ])

  // console.log('r fetch', results[0])
  // console.log('r sub', results[1])
  assertEqualResults(results[0], results[1], false)
  return results[0]
}

async function runBothKVQueries<T>(
    store: I.Store,
    keys: I.KVQuery,
    fn: (qtype: I.QueryType, q: any) => Promise<T>,
    checkEq: (a: T, b: T) => void): Promise<T> {

  assert(store.capabilities.queryTypes.has('kv'))

  // TODO: Reintroduce sorted kv ranges. For now we'll just do a KV query.

  const promises = (['kv'] as I.QueryType[])
  .filter(qtype => store.capabilities.queryTypes.has(qtype))
  .map((qtype) => {
    const query = queryTypes[qtype].q.fromKVQuery!(keys)
    return fn(qtype, query)
  }).filter(x => x != null)

  const vals = await Promise.all(promises)
  while (vals.length > 1) {
    const x = vals.shift()!
    checkEq(x, vals[0])
  }

  return vals[0]
}

async function assertKVResults(
    store: I.Store,
    keys: I.Key[],
    expectedVals: I.Val[],
    expectedVers?: I.FullVersion | I.FullVersionRange) {

  const result = await runBothKVQueries(store, new Set(keys),
    (qtype, q) => eachFetchMethod(store, qtype, q),
    assertEqualResults
  )
  if (expectedVers != null) assert(fullVersionSatisfies(expectedVers, result.versions))
}

const getOpsBoth = (store: I.Store, keys: I.Key[], versions: I.FullVersionRange, opts: I.GetOpsOptions = {}) => {
  return runBothKVQueries(
    store,
    new Set(keys),
    (qtype, q) => getOpsP(store, qtype, q, versions, opts),
    assert.deepStrictEqual
  )
}

type SingleVersion = {source: I.Source, version: I.Version}
type SingleVersionRange = {source: I.Source, version: I.VersionRange}

// Convert from a version object with exactly 1 entry to a [source, version] pair
function splitSingleVersions(versions: I.FullVersion): SingleVersion;
function splitSingleVersions(versions: I.FullVersionRange): SingleVersionRange;
function splitSingleVersions(versions: I.FullVersion | I.FullVersionRange): SingleVersion | SingleVersionRange {
  const sources = Object.keys(versions)
  assert.strictEqual(sources.length, 1)
  const source = sources[0]
  return {source, version: versions[source] as any}
}

const setSingle = async (store: I.Store, key: I.Key, value: I.Val, versions: I.FullVersion = {}): Promise<SingleVersion> => {
  // if (typeof versions === 'function') [versions, callback] = [{}, versions]
  const txn = new Map([[key, {type:'set', data:value}]])
  const vs = await mutateP(store, 'resultmap', txn, versions, {})
  return splitSingleVersions(vs)
}

const delSingle = async (store: I.Store, key: I.Key): Promise<SingleVersion> => {
  // if (typeof versions === 'function') [versions, callback] = [{}, versions]
  const txn = new Map([[key, {type:'rm'}]])
  const vs = await mutateP(store, 'resultmap', txn, {}, {})
  return splitSingleVersions(vs)
}

type SingleValue = {source: I.Source, version: I.VersionRange, value: I.Val}
const getSingle = async (store: I.Store, key: I.Key, opts?: I.FetchOpts) => {
  const r = await fetchP(store, 'kv', new Set([key]), opts || {})
  const results = r.results as Map<I.Key, I.Val>
  assert(results.size <= 1)

  // console.log('r', results.entries().next().value[1])
  const vs = splitSingleVersions(r.versions)
  const entry = results.entries().next().value
  assert.strictEqual(entry[0], key)
  return {source: vs.source, version: vs.version, value: entry[1]}
}


const getVersionForKeys = async (store: I.Store, _keys: I.Key[] | I.Key): Promise<SingleVersionRange> => {
  const keys = Array.isArray(_keys) ? new Set(_keys) : new Set([_keys])
  const {versions} = await fetchP(store, 'kv', keys, {noDocs:true})
  return splitSingleVersions(versions)
}


export default function runTests(createStore: () => Promise<I.Store>, teardownStore?: (store: I.Store) => void) {
  describe('common tests', () => {
    beforeEach(async function() {
      const store = await createStore()
      this.rawStore = store
      this.store = store//easyapi(withkv(store))
    })

    afterEach(function() {
      // TODO: And nuke all the contents.
      this.store.close()
      if (teardownStore) teardownStore(this.rawStore)
    })

    // Some simple sanity tests
    it('returns nothing when running an empty query', async function() {
      await assertKVResults(this.store, [], [])
    })

    it('returns nothing when fetching a nonexistant document', async function() {
      await assertKVResults(this.store, ['doesnotexist'], [])
    })

    it('can store things and return them', async function() {
      const txn = new Map([['a', {type:'set', data:'hi there'}]])
      const vs = await mutateP(this.store, 'resultmap', txn, {}, {})

      // The version we get back here should contain exactly 1 source with a
      // single integer version.
      assert.strictEqual(Object.keys(vs!).length, 1)
      assert.strictEqual(typeof Object.values(vs!)[0], 'number')

      await assertKVResults(this.store, ['a'], [['a', 'hi there']], vs!)
    })

    it('allows you to delete a key', async function() {
      const v1 = (await setSingle(this.store, 'a', 1)).version
      const v2 = (await delSingle(this.store, 'a')).version
      assert(v2 > v1)

      const r = await getSingle(this.store, 'a')
      const expected: SingleValue = {source: r.source, version: {from: v2, to: v2}, value: null}
      assert.deepStrictEqual(r, expected)
    })

    it('allows you to delete a nonexistant key', async function() {
      const {version} = await delSingle(this.store, 'a')
      const r = await getSingle(this.store, 'a')
      assert.equal(r.value, null)
      assert.strictEqual(version, r.version.from)
      assert.strictEqual(version, r.version.to)
    })

    // This test relies on the full version semantics of statecraft's native stores.
    it('returns acceptable version ranges for queries', async function() {
      // Set in 3 different transactions so we get a document version range.
      const {version: v1, source} = await setSingle(this.store, 'a', 1)
      const v2 = (await setSingle(this.store, 'b', 2)).version
      const v3 = (await setSingle(this.store, 'c', 3)).version

      assert(v1 < v2 && v2 < v3)
      await assertKVResults(this.store, ['a'], [['a', 1]], {[source]: {from:v1, to:v3}})
    })


    it('makes conflicting edits to the same key collide', async function() {
      // TODO: Make a parallel version of this function.
      const {source, version} = await getVersionForKeys(this.store, 'a')
      const v = version.to
      assert(v >= 0) // The version should be defined - normally 0.

      // Now set it. This should succeed...
      await setSingle(this.store, 'a', 1, {[source]:v})

      await assertThrows(async () => {
        await setSingle(this.store, 'a', 2, {[source]:v})
      }, 'WriteConflictError')
    })


    it('allows concurrent edits to different keys', async function() {
      const {source, version} = await getVersionForKeys(this.store, ['a', 'b'])
      const v = version.to
      // TODO: Make a parallel variant of this function
      await setSingle(this.store, 'a', 1, {[source]:v})
      await setSingle(this.store, 'b', 1, {[source]:v})
    })

    it('supports opts.noDocs in fetch', async function() {
      const v1 = (await setSingle(this.store, 'a', {some:'big object'})).version
      const {value, version: v2} = await getSingle(this.store, 'a', {noDocs:true})

      assert(value === true || value === 1, 'Store fetched document')
      assert.strictEqual(v1, v2.to)
    })


    it('supports conflicting read keys') // but NYI.

    describe('skv', () => {
      it('supports subscribing to a range')
      it('includes deleted documents in version information')
      it('supports skip and limit') // ??? TODO
    })

    describe('getOps', () => {
      beforeEach(async function() {
        // Setting these in a series of operations so we have something to query over.
        const {source, version: v1} = await setSingle(this.store, 'a', 1)
        this.source = source
        this.v1 = v1
        this.v2 = (await setSingle(this.store, 'b', 2)).version
        this.v3 = (await setSingle(this.store, 'a', 3)).version
        this.v4 = (await setSingle(this.store, 'b', 4)).version

        this.expectedOps = [
          {source, v:this.v1, meta:{ts:0}, txn:new Map([['a', {type:'set', data:1}]])},
          {source, v:this.v2, meta:{ts:0}, txn:new Map([['b', {type:'set', data:2}]])},
          {source, v:this.v3, meta:{ts:0}, txn:new Map([['a', {type:'set', data:3}]])},
          {source, v:this.v4, meta:{ts:0}, txn:new Map([['b', {type:'set', data:4}]])},
        ]
      })

      const emptyOpsResult: I.GetOpsResult = {ops: [], versions: {}}

      it('returns an empty list when no versions are requested', async function() {
        const ops = await getOpsBoth(this.store, ['a', 'b', 'c', 'd'], {})
        assert.deepStrictEqual(ops, emptyOpsResult)
      })

      it('returns an empty list for closed ranges', async function() {
        const ops = await getOpsBoth(this.store, ['a', 'b', 'c', 'd'], {[this.source]: {from:this.v1, to:this.v1}})
        assert.deepStrictEqual(ops, emptyOpsResult)
      })

    })
  })
}


/*


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
 */