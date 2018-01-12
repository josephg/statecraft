import * as I from '../lib/types/interfaces'
import 'mocha'
import assert = require('assert')
import registry from '../lib/types/queryops'

const fetchPromise = (store: I.Store, qtype: I.QueryType, query: any, opts: I.FetchOpts): Promise<I.FetchResults> => new Promise((resolve, reject) => {
  store.fetch(qtype, query, opts, (err, results) => {
    if (err) reject(err)
    else resolve(results)
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
    fetchPromise(store, qtype, query, {}).then(({results, versions}) => ({results, versions})),
    new Promise<SimpleResult>((resolve, reject) => {
      const rtype = registry[qtype].r
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
    const query = registry[qtype].q.fromKVQuery!(keys)
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

export default function test(createStore: () => Promise<I.Store>, teardownStore?: (store: I.Store) => void) {
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

    it('can store things and return them', function(done) {
      const txn = new Map([['a', {type:'set', data:'hi there'}]])
      this.store.mutate('resultmap', txn, {}, {}, (err: Error | null, vs?: I.FullVersion) => {
        if (err) throw err

        // The version we get back here should contain exactly 1 source with a
        // single integer version.
        assert.strictEqual(Object.keys(vs!).length, 1)
        assert.strictEqual(typeof Object.values(vs!)[0], 'number')

        assertKVResults(this.store, ['a'], [['a', 'hi there']], vs!).then(done)
      })
    })
  })
}
