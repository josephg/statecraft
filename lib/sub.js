// This file implements subscriptions for implementors.
//
// Subscriptions (aka the triangle function) are the primary API through which
// clients:
// - Stream changes to the database
// - Sync
// - Use cursors to fetch large amounts of data

const assert = require('assert')
const rangeutil = require('./rangeutil')

const queryOps = {
  kv: require('../common/setops'),
  sortedkv: require('../common/rangeops'),
}

queryOps.kv.trimResults = (results, op) => {
  if (op.remove) for (let i = 0; i < op.remove.length; i++)
    results.delete(op.remove[i])
}

queryOps.sortedkv.trimResults = (results, op) => {
  rangeutil.eachInRanges(op, results, (key, val, rval) => {
    if (rval < 0) results.delete(key)
  })
}

const doNothing = () => {}

const eachIntersect = (c1, c2, fn) => {
  // This works on maps and sets.
  if (c1.size > c2.size) {
    for (let k of c2.keys()) if (c1.has(k)) fn(k)
  } else {
    for (let k of c1.keys()) if (c2.has(k)) fn(k)
  }
}

queryOps.kv.eachTxnMatching = (txn, query, fn) => eachIntersect(c1, c2, k => fn(k, txn.get(k)))
queryOps.sortedkv.eachTxnMatching = (txn, query, fn) => rangeutil.eachInRanges(query, txn, fn)

module.exports = (supportedQueryTypes, fetch) => {
  Object.keys(supportedQueryTypes).forEach(qtype => assert(queryOps[qtype]))

  const allSubs = new Set

  const currentVersions = {}

  function fetchAtCurrent(qtype, query, opts, callback) {
    // This fetches data from the store, with a constraint that the version of
    // the data fetched should be syncronously in order with the operations
    // we're getting in our op stream.
    //
    // There's a few ways we could do that - the standard way is if the version
    // we get back is between the versions when we call fetch and the version
    // when the callback is called, we can buffer the ops from before we call
    // fetch and apply them to the query results afterwards.
    //
    // If the version is newer than that, we can wait until we see the ops
    // before returning. If the version is older we need a getOps() function of
    // some sort to fix it up.
    // 
    // TODO: Break these different cases out in a special file.
    fetch(qtype, query, {}, opts, (err, data) => {
      if (err) return callback(err)

      // TODO: Implement me - Until I can produce these cases with tests,
      // there's no point implementing them. This code will come out broken
      // without unit tests.
      const {versions} = data
      for (let s in versions) {
        assert(currentVersions[s] == null || currentVersions[s] === versions[s][1])
      }

      callback(err, data)
    })
  }

  return {
    // Should be called from the firehose - that is, its expected that this
    // function is called when any operation has been processed by the store.
    onOp(source, version, txn) {
      currentVersions[source] = version
      for (const sub of allSubs) sub._onOp(source, version, txn)
    },

    subscribe(qtype, initialQuery, versions, opts = {}, listener) {
      // TODO: specifying versions is currently ignored. I'm not sure what the
      // behaviour should be.

      assert(supportedQueryTypes[qtype])

      // Supported query types need specified ops.
      assert(queryOps[qtype])

      // Options are:
      // - Supported operation types (opts.supportedTypes) (NYI)
      // - No fetch (opts.noFetch) (implies opts.raw) (NYI)
      // - Raw? (If raw then we don't attach a copy of the data) (opts.raw, default false)
      // - Notify re version bump regardless of query? (opts.alwaysNotify, default false) TODO: consider removing this?
      // - What to do if there's no ops available from requested version (NYI)
      // - Follow symlinks? (NYI)
      // - When we poll, how much data should we fetch? (opts.limitDocs, opts.limitBytes)

      const qops = queryOps[qtype]

      const supportedTypes = new Set(opts.supportedTypes) // TODO: Add default supported types.

      // The state of the subscription is
      // - the set of keys which the client knows about and
      // - the set of keys it *wants* to know about.
      let workingQuery = qops.create()
      let pendingQuery = qops.create(initialQuery)

      let nextCallbacks = null // lock for next.

      const sub = { 
        // TODO: Should we also have a version for the pending->working query status?
        versions: {
          _query: [0, 0], // client query version
          _cursor: [0, 0], // The version of workingQuery.
        },

        data: opts.raw ? null : new Map,

        _onOp(source, version, txn) {
          let update = null

          qops.eachTxnMatching(txn, workingQuery, (k, docop) => {
            if (update == null) update = new Map

            if (supportedTypes.has(docop.type))
              update.set(k, {type: docop.type, data: docop.data})
            else
              update.set(k, {type: 'set', data: docop.newVal})

            if (this.data) this.data.set(k, docop.newVal)
          })

          let vs = this.versions[source]
          // If vs is null and there's no update, we're totally unconstrained. Discard.
          if (vs == null && update == null) return

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

        _modifyWorkQuery(workOp) {
          workingQuery = qops.apply(workingQuery, workOp)
          const vs = this.versions._cursor
          return (vs[0] = vs[1] = vs[1] + 1)
        },

        modify(qop) {
          // Syncronous because we update the pendingQuery directly.
          // TODO: How should this handle opts.noFetch?
          const cvs = this.versions._query

          // We only need to update cvs[0] here if the working set changes.
          const newCV = cvs[1] = cvs[1] + 1

          // workingQuery and pendingQuery together they make up the sub's
          // query, and we need to edit both of them based on the operation.
          const [workOp, pendingOp] = qops.split(qop, workingQuery)

          if (!qops.isNoop(workOp)) {
            cvs[0] = newCV

            // Delete everything in data that was removed by the query.
            //
            // We might also be able to weaken the other version
            // constraints, but that would require enough bookkeeping that its
            // not worth it.
            if (this.data) qops.trimResults(this.data, workOp)

            // TODO: Should I notify the client?
            this._modifyWorkQuery(workOp)
          }

          pendingQuery = qops.apply(pendingQuery, pendingOp)

          //console.log('pending, work', pendingQuery, workingQuery)
        },

        next(callback) {
          // TODO: Consider adding a query live-ness version number & operation
          // stream

          if (qops.isEmpty(pendingQuery)) { // nothing to do.
            //console.log('pending query empty', pendingQuery)
            callback && callback()
          }

          if (nextCallbacks) {
            if (callback) nextCallbacks.add(callback)
            return
          }

          nextCallbacks = new Set
          nextCallbacks.add(callback)

          // aka poll, this function fetches some more data from the store,
          // bound by the specified limit options to increase our working set
          // size.
          fetchAtCurrent(qtype, pendingQuery, {
            limitDocs: opts.limitDocs,
            limitBytes: opts.limitBytes
          }, (err, data) => {
            const done = (err) => {
              const cbs = nextCallbacks
              nextCallbacks = null
              for (const cb of cbs) cb(err)
            }

            if (err) return done(err)

            const {results, versions, queryRun} = data
            for (let s in versions) {
              const resultvs = versions[s]
              const subvs = this.versions[s]

              if (subvs == null) this.versions[s] = resultvs
              else {
                subvs[0] = Math.max(subvs[0], resultvs[0])
                assert.strictEqual(subvs[1], resultvs[1]) // guaranteed by fetchAtCurrent.
              }
            }

            // Not always needed but this is easier than bookkeeping
            this.versions._query[0] = this.versions._query[1]

            // Remove the fetched query range from the pending set...
            pendingQuery = qops.apply(pendingQuery, qops.asRemoveOp(queryRun))
            // ... and add them to the working set.
            this._modifyWorkQuery(qops.asAddOp(queryRun))

            // We need to convert the results we got into an update for the
            // client.
            // TODO: Not sure how to handle noFetch here.
            const update = new Map
            for (let [k, doc] of results) {
              if (this.data) this.data.set(k, doc)
              update.set(k, {type:'set', newVal:doc})
            }

            // TODO: ??? It might make sense to separate this from document updates.
            //update.set('_cursor', {type:qtype, data:qops.asAddOp(queryRun)})

            if (update.size !== 0) listener('poll', update, '_cursor', this.versions._cursor[1])

            done()
          })
        },

        isComplete() {
          return qops.isEmpty(pendingQuery)
        },

        cancel() {
          allSubs.delete(this)
        },
      }

      allSubs.add(sub)
      return sub
    },
  }
}

