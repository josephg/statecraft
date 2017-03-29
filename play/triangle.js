const assert = require('assert')

const eachIntersect = (c1, c2, fn) => {
  if (c1.size > c2.size) {
    for (let k of c2.keys()) if (c1.has(k)) fn(k)
  } else {
    for (let k of c1.keys()) if (c2.has(k)) fn(k)
  }
}

const doNothing = () => {}

const makeStore = () => {
  const db = new Map

  const firehoseFns = new Set

  const source = 'dummysource'
  let version = 0

  return {
    supportedQueryTypes: {kv:true},

    mutate(txn, versions = {}, opts = {}, callback = doNothing) {
      let reqv = versions[source]
      if (reqv == null) reqv = version + 1
      const actualv = version + 1

      // Scan
      for (let [k, docop] of txn) {
        const snapshot = db.get(k)
        const [lastMod, data] = snapshot == null ? [0, null] : snapshot

        if (reqv <= lastMod) {
          // Abort!
          return callback(Error('Write conflict'))
        }
      }
      
      // Ok, accept the op.
      for (let [k, docOp] of txn) {
        const snapshot = db.get(k)

        // We keep the entry even if its been deleted, so we can set the
        // correct version on a fetch that fetches the deleted document.
        db.set(k, [actualv, docOp.newVal])
      }

      // TODO: We should probably store a short history of a few ops too.
      version = actualv

      for (let fn of firehoseFns) fn(source, actualv, txn)

      callback()
    },

    _fetchSync(qtype, docs, versions, opts) {
      if (qtype !== 'kv') throw Error('only kv queries are supported')

      // TODO
      if (versions[source]) throw Error('Specifying a version is not supported')

      // Supported options:
      // - limitDocs (limit on the number of full docs we're returning. 0 for no limit)
      // - limitBytes (NYI for now)
      
      const results = new Map
      let rv = 0

      const isPartial = opts.limitDocs || opts.limitBytes
      // TODO: Not convinced by this variable name, especially since its public.
      const queryActualized = isPartial ? new Set : null 

      let resultSize = 0 // Using this instead of results.size so we don't count deleted docs.
      for (let k of docs) {
        const snapshot = db.get(k)
        const [lastMod, data] = (snapshot == null ? [0, null] : snapshot)

        if (data != null) {
          results.set(k, data)
          resultSize++
        }

        rv = Math.max(rv, lastMod)
        
        if (isPartial) queryActualized.add(k)
        if (opts.limitDocs !== 0 && resultSize >= opts.limitDocs) break
      }

      //console.log('_fetchSync', docs, results)
      return {results, versions:{[source]:[rv, version]}, queryActualized}
    },

    fetch(qtype, docs, versions, opts, callback) {
      process.nextTick(() => {
        callback(null, this._fetchSync(qtype, docs, versions, opts))
      })
    },

    onTxn(fn) { firehoseFns.add(fn) },
  }

}

function addTriangleSupport(store) {
  const triangles = new Set

  store.onTxn((source, version, txn) => {
    triangles.forEach(t => t._onOp(source, version, txn))
  })

  store.triangle = (initialQuery, opts = {}, listener) => {
    // TODO: Also pass in starting version.

    // Traingle constructor.
    //
    // For this playground I'm going to make it only handle kv ops.
    
    // Options are (stolen from subscribe)
    // - Supported operation types (opts.supportedTypes) (NYI)
    // - No fetch (opts.noFetch) (implies opts.raw) (NYI)
    // - Raw? (If raw then we don't attach a copy of the data) (opts.raw, default false)
    // - Notify re version bump always? (opts.alwaysNotify, default false)
    // - What to do if there's no ops available from requested version (NYI)
    // - Follow symlinks? (NYI)
    // - When we poll, how much data should we fetch? (opts.limitDocs, opts.limitBytes)

    // The state of the triangle is
    // - the set of keys which the client knows about and
    // - the set of keys it *wants* to know about.
    const workingKeys = new Set, pendingKeys = initialQuery || new Set

    // And the version range at which the triangle is valid. The lower part of
    // the range is the version of the most recent op which we told the client
    // about, and the upper limit of the range is the most recent version we've
    // been notified about.

    const triangle = {
      versions: {_client: [0, 0]},
      data: opts.raw ? null : new Map,

      modify(qop) {
        const newCV = this.versions._client[1] + 1
        this.versions._client[1] = newCV
        // We don't need to update _client[0] unless the query results change.

        if (qop.remove) qop.remove.forEach(k => {
          if (workingKeys.has(k)) {
            workingKeys.delete(k)

            this.versions._client[0] = newCV
            if (this.data) this.data.delete(k)

            // ... And we might be able to weaken the other version
            // constraints, but that would require enough bookkeeping that its
            // not worth it.
          }

          pendingKeys.delete(k)
        })

        if (qop.add) qop.add.forEach(k => {
          pendingKeys.add(k)
        })

        return newCV
      },

      _onOp(source, version, txn) {
        let update = null
        eachIntersect(txn, workingKeys, k => {
          if (update == null) update = new Map

          const docop = txn.get(k)
          update.set(k, docop) // TODO: supportedTypes. Look at dbroot.js:195

          if (this.data) this.data.set(k, docop.newVal)
        })

        let vs = this.versions[source]
        // If vs is null and there's no update, we're totally unconstrained. Discard.
        if (vs == null && update == null) return


        // This is all a bit hairy. It would be nice to have a schematic table
        // or something to express this logic.

        // If we have an update, update the lower bound no matter what.
        if (update != null) {
          if (vs == null) vs = this.versions[source] = [version, version]
          else vs[0] = version
        }
        // Always update the upper bound if vs exists.
        if (vs) vs[1] = version
        
        assert(update === null || update.size > 0)
        if (update || (opts.alwaysNotify && this.versions[source])) {
          listener('txn', update, source, version)
        }
      },

      next() {
        // The 'right' implementation of this on top of a normal async data source will involve making a window:
        // - First start recording transactions which overlap with the pending query results
        // - Then call fetch, requesting some documents based on the limits
        // - Then update the documents fetched based on the transactions we saw
        // - And return those documents.
        process.nextTick(() => {
          if (pendingKeys.size === 0) return

          const {results, versions, queryActualized} = store._fetchSync('kv', pendingKeys, {}, {
            limitDocs: opts.limitDocs,
            limitBytes: opts.limitBytes
          })

          for (let s in versions) {
            const resultvs = versions[s]
            const trianglevs = this.versions[s]
            if (trianglevs == null) this.versions[s] = resultvs
            else {
              trianglevs[0] = Math.max(trianglevs[0], resultvs[0])
              assert.strictEqual(trianglevs[1], resultvs[1])
            }
          }
          this.versions._client[0] = this.versions._client[1] // Not always needed but this is easier than bookkeeping

          for (let k of (queryActualized || pendingKeys)) {
            assert(!this.data.has(k))
            assert(pendingKeys.has(k))
            pendingKeys.delete(k)
            workingKeys.add(k)
          }

          const update = new Map
          for (let [k, doc] of results) {
            this.data.set(k, doc)
            update.set(k, {type:'set', newVal:doc})
          }

          if (update.size !== 0) listener('poll', update) // TODO: Does it make sense to tag this with a source?
        })

        return this.needsPoll()
      },

      needsPoll() {
        return pendingKeys.size > 0
      },

      cancel() {
        triangles.delete(this)
      },

    }

    triangles.add(triangle)
    return triangle
  }

  return store
}


if (require.main === module) {
  const store = makeStore()

  const alphabet = "abcdefghijklmnopqrstuvwxyz"
  const gen = () => {
    const key = alphabet[(Math.random() * alphabet.length)|0]
    const val = (Math.random() * 1000)|0
    const txn = new Map([[key, {type: 'set', newVal: val}]])
    store.mutate(txn)
  }

  for (let i = 0; i < 20; i++) gen()

  setInterval(() => {
    gen()
  }, 1000)

  store.onTxn((source, v, txn) => {
    console.log(source, v, txn)
  })

  addTriangleSupport(store)
  const triangle = store.triangle(new Set(['x', 'y', 'z']), {limitDocs:1}, (type, update) => { console.log('triangle', type, update, triangle.versions) })

  console.log('needsPoll', triangle.needsPoll())

  triangle.modify({add:['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']})
  console.log('needsPoll', triangle.needsPoll())

  setInterval(() => {
    triangle.next()
  }, 600)

}


