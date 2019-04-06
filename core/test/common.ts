import * as I from '../lib/interfaces'
import 'mocha'
import assert from 'assert'
import {queryTypes} from '../lib/qrtypes'
import sel from '../lib/sel'
import {vCmp, vDec, V_EMPTY, vToRange} from '../lib/version'
import {hasBit} from '../lib/bit'
import {subResults} from '../lib/subvalues'
import {inspect} from 'util'
import {Console} from 'console'

const ins = (x: any) => inspect(x, {depth: null, colors: true})


global.console = new (Console as any)({
  stdout: process.stdout,
  stderr: process.stderr,
  inspectOptions: {depth: null}
})

const assertThrows = async (block: () => Promise<void>, errType?: string) => {
  try {
    await block()
  } catch (e) {
    if (errType) assert.strictEqual(e.name, errType)
    return
  }
  throw Error('Block did not throw')
}

type SimpleResult<Val = any> = {
  results: Val,
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
  for (let i = 0; i < r1.length; i++) if (r1[i] != null) {
    const rs = r2[i]
    if (rs !== null && !versionSatisfies(r1[i]!, rs)) return false
  }
  return true
}

const assertEqualResults = (actual: SimpleResult, expected: SimpleResult, strictVersionCheck: boolean = false) => {
  // console.log('ev', expected.versions, '\nav', actual.versions)
  // assert.deepStrictEqual(actual.versions, expected.versions)
  if (strictVersionCheck) assert.deepStrictEqual(actual.versions, expected.versions)
  else assert(fullVersionSatisfies(expected.versions, actual.versions))

  // console.log('ar', actual.results)
  // console.log('er', expected.results)
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
    : qtype === I.QueryType.KV ? m
    : filter(m, keys)
)

// let nextId = 1
// Fetch using fetch() and through subscribe.
const eachFetchMethod = async <Val>(store: I.Store<Val>, query: I.Query, minVersion: I.FullVersion, keys: Set<I.Key>): Promise<SimpleResult<Val>> => {
  const qtype = query.type
  assert(hasBit(store.storeInfo.capabilities.queryTypes, qtype),
    `${qtype} queries not supported by store`)

  // let id = nextId++
  const results: SimpleResult[] = await Promise.all([
    (async () => {
      let {results, versions, bakedQuery} = await store.fetch(query, {minVersion})

      if (bakedQuery) {
        const r2 = await store.fetch(bakedQuery)
        assert.deepStrictEqual(r2.results, results)
        // TODO: And versions?
      }

      // console.log(id, 'fetch finished', versions)
      return {results: toKVMap(query.type, keys, results), versions}
    })(),
    // new Promise<SimpleResult>((resolve, reject) => {
    (async () => {
      const rtype = queryTypes[qtype].resultType
      const sub = store.subscribe(query, {supportedTypes: new Set()})
      outer: for await (const {results, versions} of subResults(rtype.type!, sub)) {
        for (let i = 0; i < minVersion.length; i++) {
          const mv = minVersion[i]
          if (mv && vCmp(versions[i]!.to, mv) < 0) {
            console.log(id, 'waitting...', mv, versions)
            continue outer
          }
        }
        // console.log(id, 'sub finished')
        // console.log('ok')
        // Ok we're done.
        sub.return()
        // console.log(query.type, 'r', versions)
        return {results: toKVMap(query.type, keys, results), versions}
      }
      throw Error('Subscription closed prematurely')
    })()
  ])

  // console.log('r fetch', query.type, results[0])
  // console.log('r sub', query.type, results[1])
  // assertEqualResults(results[0], results[1], false)

  while (results.length > 1) {
    const x = results.shift()!
    // console.log('qtype', qtype, 'x', x, results[0])
    assertEqualResults(x, results[0], false)
  }
  return results[0]
}

async function runAllKVQueries<T>(
    store: I.Store<any>,
    keys: I.KVQuery,
    fn: (q: I.Query, keys: I.KVQuery) => Promise<T>,
    allowRange: boolean
    // checkEq: (a: T, b: T) => void
): Promise<T[]> {
  assert(hasBit(store.storeInfo.capabilities.queryTypes, I.QueryType.KV), 'Store does not support KV queries')

  // TODO: Add regular ranges here as well.
  // const promises = (['range'] as I.QueryType[])
  const types: I.QueryType[] = [I.QueryType.KV, I.QueryType.AllKV, I.QueryType.StaticRange]
  // const types: I.QueryType[] = []
  if (allowRange) types.push(I.QueryType.Range)

  const promises = types.filter(qtype => hasBit(store.storeInfo.capabilities.queryTypes, qtype))
  .map(qtype => {
    const query = qtype === I.QueryType.StaticRange || qtype === I.QueryType.Range
      ? Array.from(keys).map(k => ({
          low: sel(k, false),
          high: sel(k, true),
        }))
      : qtype === I.QueryType.KV ? keys
      : true

    return fn({type: qtype, q: query} as I.Query, keys)
  }) //.filter(x => x != null)

  const vals = await Promise.all(promises)

  // console.log('vals', ins(vals))
  return vals
}

async function assertKVResults<Val>(
    store: I.Store<Val>,
    keys: I.Key[],
    minVersion: I.FullVersion,
    expectedVals: [I.Key, Val][],
    expectedVers?: I.FullVersion | I.FullVersionRange) {

  const results = await runAllKVQueries<SimpleResult<Val>>(
    store,
    new Set(keys),
    (query, keys) => eachFetchMethod(store, query, minVersion, keys),
    true
  )
  // console.log('expected', ins(expectedVals), ins(expectedVers))
  // console.log('actual', ins(result))

  results.forEach(r => {
    assert.deepStrictEqual(r.results, new Map(expectedVals))
    // console.log('rv', r.versions)
    // console.log('ev', expectedVers)
    // if (expectedVers) console.log('satisfies', fullVersionSatisfies(expectedVers, r.versions))
    if (expectedVers != null) assert(fullVersionSatisfies(expectedVers, r.versions), 'Version does not match')
  })

  // TODO: Then take the queryRun and pass it back into the store & check we
  // get the same thing.

}

const getOpsBoth = async (store: I.Store<any>, keys: I.Key[], versions: I.FullVersionRange, opts: I.GetOpsOptions = {}) => {
  const vals = await runAllKVQueries<I.GetOpsResult<any>>(
    store,
    new Set(keys),
    async (query, keys) => {
      let results = await store.getOps(query, versions, opts)
      if (query.type === I.QueryType.AllKV) {
        results.ops.filter(txn => {
          const txn_ = queryTypes[I.QueryType.KV].adaptTxn(txn.txn, keys)
          if (txn_ == null) return false
          else {
            txn.txn = txn_
            return true
          }
        })
      }
      results.ops = results.ops.filter(op => {
        op.txn = toKVMap(query.type, keys, op.txn as I.KVTxn<any> | I.RangeTxn<any>)
        return op.txn.size > 0
      })
      return results
    },
    false
  )

  while (vals.length > 1) {
    const x = vals.shift()!
    assert.deepStrictEqual(x, vals[0])
  }

  return vals[0]
}

type SingleVersion<V> = {source: I.Source, version: V}

// Convert from a version object with exactly 1 entry to a [source, version] pair
function splitSingleVersions<V>(store: I.Store<any>, versions: (V | null)[]): SingleVersion<V> {
  const sources = store.storeInfo.sources
  // Only 1 version from the versions array should be non-null.
  const idxArr = versions
    .map((v, i) => v == null ? -1 : i)
    .filter(i => i >= 0)

  assert.strictEqual(idxArr.length, 1)
  const idx = idxArr[0]
  return {
    source: sources[idx],
    version: versions[idx]!
  }
}

// TODO: Consider replacing these with the equivalents in utils.
const ssTxn = <Val>(k: I.Key, v: Val): I.KVTxn<Val> => new Map([[k, {type:'set', data:v}]])
const setSingle = async <Val>(store: I.Store<Val>, key: I.Key, value: Val, versions: I.FullVersion = []): Promise<SingleVersion<I.Version>> => {
  // if (typeof versions === 'function') [versions, callback] = [{}, versions]
  const txn = ssTxn(key, value)
  const vs = await store.mutate(I.ResultType.KV, txn, versions, {})
  return splitSingleVersions(store, vs)
}

const delSingle = async (store: I.Store<any>, key: I.Key): Promise<SingleVersion<I.Version>> => {
  // if (typeof versions === 'function') [versions, callback] = [{}, versions]
  const txn = new Map([[key, {type:'rm'}]])
  const vs = await store.mutate(I.ResultType.KV, txn)
  return splitSingleVersions(store, vs)
}

type SingleValue<Val = any> = {source: I.Source, version: I.VersionRange, value: Val}
const getSingle = async <Val>(store: I.Store<Val>, key: I.Key, opts?: I.FetchOpts) => {
  const r = await store.fetch({type:I.QueryType.KV, q:new Set([key])}, opts)
  const results = r.results as Map<I.Key, Val>
  assert(results.size <= 1)

  // console.log('r', results.entries().next().value[1])
  const vs = splitSingleVersions(store, r.versions)
  const entry = results.entries().next().value
  if (entry != null) assert.strictEqual(entry[0], key)
  return {source: vs.source, version: vs.version, value: entry ? entry[1] : null}
}


const getVersionForKeys = async (store: I.Store<any>, _keys: I.Key[] | I.Key): Promise<SingleVersion<I.VersionRange>> => {
  const keys = Array.isArray(_keys) ? new Set(_keys) : new Set([_keys])
  const {versions} = await store.fetch({type:I.QueryType.KV, q:keys}, {noDocs:true})
  return splitSingleVersions(store, versions)
}

const sparseSV = <V>(source: I.Source, store: I.Store<any>, val: V): (V | null)[] => {
  const i = store.storeInfo.sources.indexOf(source)
  if (i < 0) throw Error('Invalid source - source ' + source + ' not in storeinfo')
  const result = []
  result[i] = val
  return result
}

interface Context extends Mocha.Context {
  store: I.Store<any>
}

export default function runTests(createStore: () => Promise<I.Store<any>>, teardownStore?: (store: I.Store<any>) => void) {
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
      await assertKVResults(this.store, [], [], [])
    })

    it('returns nothing when fetching a nonexistant document', async function() {
      await assertKVResults(this.store, ['doesnotexist'], [], [])
    })

    it('can store things and return them', async function() {
      const txn = new Map([['a', {type:'set', data:'hi there'}]])
      const vs = await (this.store as I.Store<any>).mutate(I.ResultType.KV, txn, [], {})

      // The version we get back here should contain exactly 1 source with a
      // single integer version.
      assert.strictEqual(Object.keys(vs!).length, 1)

      assert(Object.values(vs!)[0] instanceof Uint8Array)

      await assertKVResults(this.store, ['a'], vs, [['a', 'hi there']], vs!)
    })

    it('allows you to delete a key', async function() {
      const v1 = (await setSingle(this.store, 'a', 1)).version
      const v2 = (await delSingle(this.store, 'a')).version
      assert(vCmp(v2, v1) > 0)

      const r = await getSingle(this.store, 'a', {minVersion: [v2]})
      const expected: SingleValue = {source: r.source, version: {from: v2, to: v2}, value: null}

      assert.deepStrictEqual(r, expected)
    })

    it('allows you to delete a nonexistant key', async function() {
      const {version} = await delSingle(this.store, 'a')
      const r = await getSingle(this.store, 'a', {minVersion: [version]})
      assert.equal(r.value, null)
      assert.deepStrictEqual(version, r.version.from)
      assert.deepStrictEqual(version, r.version.to)
    })

    // This test relies on the full version semantics of statecraft's native stores.
    it('returns acceptable version ranges for queries', async function() {
      // Set in 3 different transactions so we get a document version range.
      const {source, version: v1} = await setSingle(this.store, 'a', 1)
      const v2 = (await setSingle(this.store, 'b', 2)).version
      const v3 = (await setSingle(this.store, 'c', 3)).version

      assert(vCmp(v1, v2) < 0 && vCmp(v2, v3) < 0)
      await assertKVResults(this.store, ['a'], [v3], [['a', 1]], sparseSV(source, this.store, {from:v1, to:v3}))
    })

    it('makes conflicting edits to the same key collide', async function() {
      // TODO: Make a parallel version of this function.
      const {source, version} = await getVersionForKeys(this.store, 'a')
      const v = version.to
      assert(vCmp(v, new Uint8Array()) > 0, 'Empty version in fetch') // The version should be defined - normally zeros.

      // Now set it. This should succeed...
      await setSingle(this.store, 'a', 1, sparseSV(source, this.store, v))

      await assertThrows(async () => {
        await setSingle(this.store, 'a', 2, sparseSV(source, this.store, v))
      }, 'WriteConflictError')
    })


    it('allows concurrent edits to different keys', async function() {
      const {source, version} = await getVersionForKeys(this.store, ['a', 'b'])
      const v = version.to
      // TODO: Make a parallel variant of this function
      await setSingle(this.store, 'a', 1, sparseSV(source, this.store, v))
      await setSingle(this.store, 'b', 1, sparseSV(source, this.store, v))
    })

    it('supports opts.noDocs in fetch', async function() {
      const v1 = (await setSingle(this.store, 'a', {some:'big object'})).version
      const {value, version: v2} = await getSingle(this.store, 'a', {noDocs:true, minVersion: [v1]})

      assert(value === true || value === 1, 'Store should not fetch document')
      assert.deepStrictEqual(v1, v2.to)
    })


    it('supports conflicting read keys') // but NYI.

    describe('object model', () => {
      it('a document that was never created does not appear in a kv result set', async function() {
        const store = (this as Context).store
        if (!hasBit(store.storeInfo.capabilities.queryTypes, I.QueryType.KV)) this.skip()


        const result = await store.fetch({type:I.QueryType.KV, q:new Set(['x'])})
        assert(!result.results.has('x'))
      })

      it('a document with value null does not appear in a kv result set', async function() {
        const store = (this as Context).store
        if (!hasBit(store.storeInfo.capabilities.queryTypes, I.QueryType.KV)) this.skip()

        await setSingle(store, 'x', 123)
        await setSingle(store, 'x', null)

        await setSingle(store, 'y', 321)
        await delSingle(store, 'y')

        const result = await store.fetch({type:I.QueryType.KV, q:new Set(['x', 'y'])})
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
          {versions:sparseSV(source, this.store, this.v1), txn:ssTxn('a', 1), meta:{}},
          {versions:sparseSV(source, this.store, this.v2), txn:ssTxn('b', 2), meta:{}},
          {versions:sparseSV(source, this.store, this.v3), txn:ssTxn('a', 3), meta:{}},
          {versions:sparseSV(source, this.store, this.v4), txn:ssTxn('b', 4), meta:{}},
        ]

        this.allVersions = sparseSV(source, this.store, {from: vDec(this.v1), to: this.v4})
      })

      const emptyOpsResult: I.GetOpsResult<any> = Object.freeze({ops: [], versions: []})

      it('returns an empty list when no versions are requested', async function() {
        const result = await getOpsBoth(this.store, ['a', 'b', 'c', 'd'], [])
        assert.deepStrictEqual(result, emptyOpsResult)
      })

      it('returns an empty list for closed ranges', async function() {
        const result = await getOpsBoth(this.store, ['a', 'b', 'c', 'd'], sparseSV(this.source, this.store, {from:this.v1, to:this.v1}))
        // TODO: I'm not sure if this should return [from:v1, to:v1] or just [].
        assert.deepStrictEqual(result, {ops:[], versions: [{from:this.v1, to:this.v1}]})
      })
      
      it('returns an empty list with the current version when the top of the range is unbounded', async function() {        
        const result = await getOpsBoth(this.store, ['a', 'b', 'c', 'd'], sparseSV(this.source, this.store, {from:this.v4, to:V_EMPTY}))
        assert.deepStrictEqual(result, {ops:[], versions: [{from:this.v4, to:this.v4}]})
      })

      it('gets all ops when the top range is unbound', async function() {
        const result = await getOpsBoth(this.store, ['a', 'b'], sparseSV(this.source, this.store, {from:vDec(this.v1), to:V_EMPTY}))
        assert.deepStrictEqual(result.versions, this.allVersions)
        assert.deepStrictEqual(result.ops, this.expectedOps)
      })

      it('gets all ops when the range is explicit', async function() {
        const result = await getOpsBoth(this.store, ['a', 'b', 'c', 'd'], sparseSV(this.source, this.store, {from:vDec(this.v1), to:this.v4}))
        assert.deepStrictEqual(result.versions, this.allVersions)
        assert.deepStrictEqual(result.ops, this.expectedOps)
      })

      it('filters the operations based on the query', async function() {
        const result = await getOpsBoth(this.store, ['a'], sparseSV(this.source, this.store, {from:vDec(this.v1), to:this.v4}))
        assert.deepStrictEqual(result.versions, this.allVersions)
        assert.deepStrictEqual(result.ops, [this.expectedOps[0], this.expectedOps[2]])
      })

      it('filters operations based on the supplied versions', async function() {
        const result = await getOpsBoth(this.store, ['a', 'b'], sparseSV(this.source, this.store, {from:this.v1, to:this.v3}))
        assert.deepStrictEqual(result.versions, sparseSV(this.source, this.store, {from: this.v1, to: this.v3}))
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
        const sub = (this.store as I.Store<any>).subscribe({type: I.QueryType.KV, q: new Set(['a'])}, {fromVersion: sparseSV(this.source, this.store, this.v1)})

        // The first message will be a catchup, which should be empty.
        const {value: catchup} = await sub.next()
        // console.log('cu', catchup, catchup.txns)
        assert.deepStrictEqual(catchup.txns, [])

        const v2 = (await setSingle(this.store, 'a', 2)).version
        const {value: update} = await sub.next()
        assert.deepStrictEqual(update.txns[0].txn, ssTxn('a', 2))
        assert.deepStrictEqual(update.toVersion[this.store.storeInfo.sources.indexOf(this.source)], v2)
      })

      it('allows you to subscribe from the previous version, specified explicitly', async function() {
        const v2 = (await setSingle(this.store, 'a', 2)).version

        const sub = (this.store as I.Store<any>).subscribe({type: I.QueryType.KV, q: new Set(['a'])}, {fromVersion: sparseSV(this.source, this.store, this.v1)})

        // The first message will be a catchup, which should bring us to v2.
        const {value: catchup} = await sub.next()
        // Depending on the store, this might return a replace operation.
        if (catchup.replace) assert.deepStrictEqual(catchup.replace.with.get('a'), 2)
        else assert.deepStrictEqual(catchup.txns[0].txn, ssTxn('a', 2))

        const si = this.store.storeInfo.sources.indexOf(this.source)
        assert.deepStrictEqual(catchup.toVersion[si], v2)
        
        // And we should also be able to submit a subsequent op to get to v3.
        const v3 = (await setSingle(this.store, 'a', 3)).version
        const {value: update} = await sub.next()
        assert.deepStrictEqual(update.txns[0].txn, ssTxn('a', 3))
        assert.deepStrictEqual(update.toVersion[si], v3)
      })

      it('propogates a subscription close through to the backing store') // No idea how to test this here.
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