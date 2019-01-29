import * as I from '../lib/interfaces'
import 'mocha'
import assert from 'assert'
import {queryTypes} from '../lib/qrtypes'
import sel from '../lib/sel'
import {vCmp, vDec} from '../lib/version'

import {inspect} from 'util'
const ins = (x: any) => inspect(x, {depth: null, colors: true})

const assertThrows = async (block: () => Promise<void>, errType?: string) => {
  try {
    await block()
  } catch (e) {
    if (errType) assert.strictEqual(e.name, errType)
    return
  }
  throw Error('Block did not throw')
}

type SimpleResult = {
  results: any,
  versions: I.FullVersionRange,
}

const rangeContainsVersion = (range: I.VersionRange, v: I.Version) => vCmp(v, range.from) >= 0 && vCmp(v, range.to) <= 0
const rangeContainsRange = (r1: I.VersionRange, r2: I.VersionRange) => vCmp(r1.from, r2.from) <= 0 && vCmp(r1.to, r2.to) >= 0
const rangeContainsV = (range: I.VersionRange, v: I.Version | I.VersionRange) =>
  v instanceof Uint8Array ? rangeContainsVersion(range, v) : rangeContainsRange(range, v)
const versionAtLeast = (v1: I.Version, v2: I.Version | I.VersionRange) =>
  v2 instanceof Uint8Array ? v2 >= v1 : v2.from >= v1
const versionSatisfies = (v1: I.Version | I.VersionRange, v2: I.Version | I.VersionRange) =>
  v1 instanceof Uint8Array ? versionAtLeast(v1, v2) : rangeContainsV(v1, v2)

const fullVersionSatisfies = (r1: I.FullVersion | I.FullVersionRange, r2: I.FullVersion | I.FullVersionRange) => {
  for (let source in r1) {
    const rs = r2[source]
    if (rs !== null && !versionSatisfies(r1[source], rs)) return false
  }
  return true
}

const assertEqualResults = (actual: SimpleResult, expected: SimpleResult, strictVersionCheck: boolean = false) => {
  // console.log('ev', expected.versions, 'av', actual.versions)
  // assert.deepStrictEqual(actual.versions, expected.versions)
  if (strictVersionCheck) assert.deepStrictEqual(actual.versions, expected.versions)
  else assert(fullVersionSatisfies(expected.versions, actual.versions))

  assert.deepStrictEqual(actual.results, expected.results)
}

const id = <T>(x: T) => x
const flatMap = <X, Y>(arr: X[], f: (a: X) => Y[]): Y[] => ([] as Y[]).concat.apply([], arr.map(f))
const filter = <K, V>(orig: Map<K, V>, keep: Set<K>) => {
  const result = new Map<K, V>()
  for (const k of keep) {
    const v = orig.get(k)
    if (v !== undefined) result.set(k, v)
  }
  return result
}
const toKVMap = <T>(qtype: I.QueryType, keys: Set<I.Key>, m: Map<I.Key, T> | [I.Key, T][][]): Map<I.Key, T> => (
  !(m instanceof Map)
    ? new Map(flatMap(m, id))
    : qtype === 'kv' ? m
    : filter(m, keys)
)

// Fetch using fetch() and through subscribe.
const eachFetchMethod = async (store: I.Store, query: I.Query, keys: Set<I.Key>): Promise<SimpleResult> => {
  const qtype = query.type
  assert(store.storeInfo.capabilities.queryTypes.has(qtype),
    `${qtype} queries not supported by store`)

  const results: SimpleResult[] = await Promise.all([
    store.fetch(query).then(({results, versions}) => ({results: toKVMap(query.type, keys, results), versions})),
    // new Promise<SimpleResult>((resolve, reject) => {
    (async () => {
      const rtype = queryTypes[qtype].resultType
      let r: any = rtype.create()

      const sub = store.subscribe(query, {supportedTypes: new Set()})

      const versions: I.FullVersionRange = {}

      // We'll just pull off the first update.
      const update = (await sub.next()).value!
      // console.log('catchup update', ins(update))

      if (update.replace) {
        // console.log('r1', ins(r))
        r = queryTypes[qtype].updateResults(r, update.replace.q.q, update.replace.with)
        // console.log('r2', ins(r))

        const vs = update.replace.versions
        for (const s in vs) versions[s] = {from: vs[s], to: vs[s]}
      }

      update.txns.forEach(txn => {rtype.applyMut!(r, txn.txn)})

      for (const s in update.toVersion) {
        if (versions[s]) versions[s].to = update.toVersion[s]
        else versions[s] = {from: update.toVersion[s], to: update.toVersion[s]}
      }

      sub.return()
      return {results: toKVMap(query.type, keys, r), versions}
    })()
  ])

  // console.log('r fetch', query.type, results[0])
  // console.log('r sub', query.type, results[1])
  // assertEqualResults(results[0], results[1], false)

  while (results.length > 1) {
    const x = results.shift()!
    assertEqualResults(x, results[0], false)
  }
  return results[0]
}

async function runBothKVQueries<T>(
    store: I.Store,
    keys: I.KVQuery,
    fn: (q: I.Query, keys: I.KVQuery) => Promise<T>,
    // checkEq: (a: T, b: T) => void
): Promise<T[]> {

  assert(store.storeInfo.capabilities.queryTypes.has('kv'))

  // TODO: Add regular ranges here as well.
  const promises = (['kv', 'allkv', 'static range'] as I.QueryType[])
  .filter(qtype => store.storeInfo.capabilities.queryTypes.has(qtype))
  .map(qtype => {
    const query = qtype === 'static range'
      ? Array.from(keys).map(k => ({
          low: sel(k, false),
          high: sel(k, true),
        }))
      : qtype === 'kv' ? keys
      : true

    return fn({type: qtype, q: query} as I.Query, keys)
  }) //.filter(x => x != null)

  const vals = await Promise.all(promises)

  // console.log('vals', ins(vals))
  return vals
}

async function assertKVResults(
    store: I.Store,
    keys: I.Key[],
    expectedVals: [I.Key, I.Val][],
    expectedVers?: I.FullVersion | I.FullVersionRange) {

  const results = await runBothKVQueries<SimpleResult>(
    store,
    new Set(keys),
    (query, keys) => eachFetchMethod(store, query, keys),
    // assertEqualResults
  )
  // console.log('expected', ins(expectedVals), ins(expectedVers))
  // console.log('actual', ins(result))

  results.forEach(r => {
    assert.deepStrictEqual(r.results, new Map(expectedVals))
    // console.log('rv', r.versions)
    // console.log('ev', expectedVers)
    // if (expectedVers) console.log('satisfies', fullVersionSatisfies(expectedVers, r.versions))
    if (expectedVers != null) assert(fullVersionSatisfies(expectedVers, r.versions))
  })

  // TODO: Then take the queryRun and pass it back into the store & check we
  // get the same thing.

}

const getOpsBoth = async (store: I.Store, keys: I.Key[], versions: I.FullVersionRange, opts: I.GetOpsOptions = {}) => {
  const vals = await runBothKVQueries<I.GetOpsResult>(
    store,
    new Set(keys),
    async (query, keys) => {
      let results = await store.getOps(query, versions, opts)
      if (query.type === 'allkv') {
        results.ops.filter(txn => {
          const txn_ = queryTypes.kv.adaptTxn(txn.txn, keys)
          if (txn_ == null) return false
          else {
            txn.txn = txn_
            return true
          }
        })
      }
      results.ops = results.ops.filter(op => {
        op.txn = toKVMap(query.type, keys, op.txn as I.KVTxn | I.RangeTxn)
        return op.txn.size > 0
      })
      return results
    },
    // assert.deepStrictEqual
  )

  while (vals.length > 1) {
    const x = vals.shift()!
    assert.deepStrictEqual(x, vals[0])
  }

  return vals[0]
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

const ssTxn = (k: I.Key, v: I.Val): I.KVTxn => new Map([[k, {type:'set', data:v}]])
const setSingle = async (store: I.Store, key: I.Key, value: I.Val, versions: I.FullVersion = {}): Promise<SingleVersion> => {
  // if (typeof versions === 'function') [versions, callback] = [{}, versions]
  const txn = ssTxn(key, value)
  const vs = await store.mutate('kv', txn, versions, {})
  return splitSingleVersions(vs)
}

const delSingle = async (store: I.Store, key: I.Key): Promise<SingleVersion> => {
  // if (typeof versions === 'function') [versions, callback] = [{}, versions]
  const txn = new Map([[key, {type:'rm'}]])
  const vs = await store.mutate('kv', txn, {}, {})
  return splitSingleVersions(vs)
}

type SingleValue = {source: I.Source, version: I.VersionRange, value: I.Val}
const getSingle = async (store: I.Store, key: I.Key, opts?: I.FetchOpts) => {
  const r = await store.fetch({type:'kv', q:new Set([key])}, opts)
  const results = r.results as Map<I.Key, I.Val>
  assert(results.size <= 1)

  // console.log('r', results.entries().next().value[1])
  const vs = splitSingleVersions(r.versions)
  const entry = results.entries().next().value
  if (entry != null) assert.strictEqual(entry[0], key)
  return {source: vs.source, version: vs.version, value: entry ? entry[1] : null}
}


const getVersionForKeys = async (store: I.Store, _keys: I.Key[] | I.Key): Promise<SingleVersionRange> => {
  const keys = Array.isArray(_keys) ? new Set(_keys) : new Set([_keys])
  const {versions} = await store.fetch({type:'kv', q:keys}, {noDocs:true})
  return splitSingleVersions(versions)
}

interface Context extends Mocha.Context {
  store: I.Store
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
      const vs = await this.store.mutate('kv', txn, {}, {})

      // The version we get back here should contain exactly 1 source with a
      // single integer version.
      assert.strictEqual(Object.keys(vs!).length, 1)
      assert(Object.values(vs!)[0] instanceof Uint8Array)

      await assertKVResults(this.store, ['a'], [['a', 'hi there']], vs!)
    })

    it('allows you to delete a key', async function() {
      const v1 = (await setSingle(this.store, 'a', 1)).version
      const v2 = (await delSingle(this.store, 'a')).version
      assert(vCmp(v2, v1) > 0)

      const r = await getSingle(this.store, 'a')
      const expected: SingleValue = {source: r.source, version: {from: v2, to: v2}, value: null}

      assert.deepStrictEqual(r, expected)
    })

    it('allows you to delete a nonexistant key', async function() {
      const {version} = await delSingle(this.store, 'a')
      const r = await getSingle(this.store, 'a')
      assert.equal(r.value, null)
      assert.deepStrictEqual(version, r.version.from)
      assert.deepStrictEqual(version, r.version.to)
    })

    // This test relies on the full version semantics of statecraft's native stores.
    it('returns acceptable version ranges for queries', async function() {
      // Set in 3 different transactions so we get a document version range.
      const {version: v1, source} = await setSingle(this.store, 'a', 1)
      const v2 = (await setSingle(this.store, 'b', 2)).version
      const v3 = (await setSingle(this.store, 'c', 3)).version

      assert(vCmp(v1, v2) < 0 && vCmp(v2, v3) < 0)
      await assertKVResults(this.store, ['a'], [['a', 1]], {[source]: {from:v1, to:v3}})
    })

    it('makes conflicting edits to the same key collide', async function() {
      // TODO: Make a parallel version of this function.
      const {source, version} = await getVersionForKeys(this.store, 'a')
      const v = version.to
      assert(v >= new Uint8Array()) // The version should be defined - normally 0.

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

      assert(value === true || value === 1, 'Store should not fetch document')
      assert.deepStrictEqual(v1, v2.to)
    })


    it('supports conflicting read keys') // but NYI.

    describe('object model', () => {
      it('a document that was never created does not appear in a kv result set', async function() {
        const store = (this as Context).store
        if (!store.storeInfo.capabilities.queryTypes.has('kv')) this.skip()


        const result = await store.fetch({type:'kv', q:new Set(['x'])})
        assert(!result.results.has('x'))
      })

      it('a document with value null does not appear in a kv result set', async function() {
        const store = (this as Context).store
        if (!store.storeInfo.capabilities.queryTypes.has('kv')) this.skip()

        await setSingle(store, 'x', 123)
        await setSingle(store, 'x', null)

        await setSingle(store, 'y', 321)
        await delSingle(store, 'y')

        const result = await store.fetch({type:'kv', q:new Set(['x', 'y'])})
        assert.strictEqual(result.results.size, 0)
      })

      it('a document which was made null by an OT operation does not appear in kv results')


      it('allows operations to be submitted against missing documents. Apply gets snapshot: null')
      it('transforms correctly if two operations have identical create arguments')
      it('allows two concurrent operations with the same create argument to mutually succeed')
      it('ignores create arguments if the document exists')
      it('transforms with different create parameters conflict')

    })

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
          {versions:{[source]: this.v1}, txn:ssTxn('a', 1), meta:{}},
          {versions:{[source]: this.v2}, txn:ssTxn('b', 2), meta:{}},
          {versions:{[source]: this.v3}, txn:ssTxn('a', 3), meta:{}},
          {versions:{[source]: this.v4}, txn:ssTxn('b', 4), meta:{}},
        ]

        this.allVersions = <I.FullVersionRange>{
          [this.source]: {from: vDec(this.v1), to: this.v4}
        }
      })

      const emptyOpsResult: I.GetOpsResult = {ops: [], versions: {}}

      it('returns an empty list when no versions are requested', async function() {
        const result = await getOpsBoth(this.store, ['a', 'b', 'c', 'd'], {})
        assert.deepStrictEqual(result, emptyOpsResult)
      })

      it('returns an empty list for closed ranges', async function() {
        const result = await getOpsBoth(this.store, ['a', 'b', 'c', 'd'], {[this.source]: {from:this.v1, to:this.v1}})
        assert.deepStrictEqual(result, emptyOpsResult)
      })

      it('gets all ops when the top range is unbound', async function() {
        const result = await getOpsBoth(this.store, ['a', 'b'], {[this.source]: {from:vDec(this.v1), to:new Uint8Array()}})
        assert.deepStrictEqual(result.versions, this.allVersions)
        assert.deepStrictEqual(result.ops, this.expectedOps)
      })

      it('gets all ops when the range is explicit', async function() {
        const result = await getOpsBoth(this.store, ['a', 'b', 'c', 'd'], {[this.source]: {from:vDec(this.v1), to:this.v4}})
        assert.deepStrictEqual(result.versions, this.allVersions)
        assert.deepStrictEqual(result.ops, this.expectedOps)
      })

      it('filters the operations based on the query', async function() {
        const result = await getOpsBoth(this.store, ['a'], {[this.source]: {from:vDec(this.v1), to:this.v4}})
        assert.deepStrictEqual(result.versions, this.allVersions)
        assert.deepStrictEqual(result.ops, [this.expectedOps[0], this.expectedOps[2]])
      })

      it('filters operations based on the supplied versions', async function() {
        const result = await getOpsBoth(this.store, ['a', 'b'], {[this.source]: {from:this.v1, to:this.v3}})
        assert.deepStrictEqual(result.versions, <I.FullVersionRange>{
          [this.source]: {from: this.v1, to: this.v3}
        })
        assert.deepStrictEqual(result.ops, [this.expectedOps[1], this.expectedOps[2]])
      })


      // TODO: How does the op store respond to operations which edit multiple keys?
    })

    describe('subscribe', () => {
      beforeEach(async function() {
        const {source, version: v1} = await setSingle(this.store, 'a', 1)
        // console.log('v1', v1)
        this.source = source
        this.v1 = v1
      })

      it('allows you to subscribe from the current version, specified explicitly', async function() {
        const sub = (this.store as I.Store).subscribe({type: 'kv', q: new Set(['a'])}, {fromVersion: {[this.source]: this.v1}})

        // The first message will be a catchup, which should be empty.
        const {value: catchup} = await sub.next()
        // console.log('cu', catchup, catchup.txns)
        assert.deepStrictEqual(catchup.txns, [])

        const v2 = (await setSingle(this.store, 'a', 2)).version
        const {value: update} = await sub.next()
        assert.deepStrictEqual(update.txns[0].txn, ssTxn('a', 2))
        assert.deepStrictEqual(update.toVersion[this.source], v2)
      })

      it('allows you to subscribe from the previous version, specified explicitly', async function() {
        const v2 = (await setSingle(this.store, 'a', 2)).version

        const sub = (this.store as I.Store).subscribe({type: 'kv', q: new Set(['a'])}, {fromVersion: {[this.source]: this.v1}})

        // The first message will be a catchup, which should bring us to v2.
        const {value: catchup} = await sub.next()
        assert.deepStrictEqual(catchup.txns[0].txn, ssTxn('a', 2))
        assert.deepStrictEqual(catchup.toVersion[this.source], v2)

        // And we should also be able to submit a subsequent op to get to v3.
        const v3 = (await setSingle(this.store, 'a', 3)).version
        const {value: update} = await sub.next()
        assert.deepStrictEqual(update.txns[0].txn, ssTxn('a', 3))
        assert.deepStrictEqual(update.toVersion[this.source], v3)
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