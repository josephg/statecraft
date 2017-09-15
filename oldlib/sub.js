// This file implements subscriptions for implementors.
//
// Subscriptions (aka the triangle function) are the primary API through which
// clients:
// - Stream changes to the database
// - Sync
// - Use cursors to fetch large amounts of data

const assert = require('assert')
const rangeutil = require('./rangeutil')
const resultset = require('./resultset')

// Object.assign because I'm going to add some utility methods below and I want
// to be explicit when I share those methods with other modules.
const queryops = Object.assign({}, require('../common/queryops'))

queryops.kv.trimResults = (results, op) => {
  if (op.remove) for (let i = 0; i < op.remove.length; i++)
    results.delete(op.remove[i])
}

queryops.sortedkv.trimResults = (results, op) => {
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

queryops.kv.eachTxnMatching = (txn, query, fn) => eachIntersect(txn, query, k => fn(k, txn.get(k)))
queryops.sortedkv.eachTxnMatching = (txn, query, fn) => rangeutil.eachInRanges(query, txn, fn)

// Used as a placeholder for notifying an empty update. Never modified.
const emptyMap = new Map

module.exports = (capabilities, catchup) => {
  capabilities.queryTypes.forEach(qtype => assert(queryops[qtype]))

  const allSubs = new Set

  const currentVersions = {}

  return {
    // Should be called from the firehose - that is, its expected that this
    // function is called when any operation has been processed by the store.
    onOp(source, version, txn) {
      currentVersions[source] = version
      for (const sub of allSubs) sub._onOp(source, version, txn)

      if (opsBuffer) opsBuffer.push({source, version, txn})
    },

    subscribe(qtype, initialQuery, _, opts = {}, listener) {
      // TODO: Should specifying a version be done through the options like it is for fetch?

      // The listener is called with (type, update, versionUpdate, this). The
      // versions argument is {[source]: [v0, v1]}. Why? Well, because it
      // matches the version semantics of the data itself. And the first value
      // won't be changed if the result set hasn't actually been updated.

      // Supported query types need specified ops.
      assert(queryops[qtype])

      // Options are:
      // - Supported operation types (opts.supportedTypes)
      // - No fetch (opts.noFetch) (implies opts.raw) (NYI)
      // - Notify re version bump regardless of query? (opts.alwaysNotify,
      //   default false) TODO: consider removing this?
      // - What to do if there's no ops available from requested version (NYI)
      // - Follow symlinks? (NYI)
      // - When we poll, how much data should we fetch? (opts.limitDocs, opts.limitBytes)
      // - Stop the query after a certain number of operations (opts.limitOps) (NYI)
      // - Should we send updates for the cursor object itself? (opts.trackCursor)
      //
      // For reconnecting, you can specify:
      // - Which documents the client has a copy of (opts.knownDocs)
      // - Which versions the specified documents are known at (opts.knownAtVersions)
      // - ... And something to specify the catchup mode (fast vs full)
      // - opts.getFullHistortForDocs - or something like it.
      // These options should appear together.

      const qops = queryops[qtype]

      const supportedTypes = resultset.fromUserSupportedTypes(opts.supportedTypes)

      // The state of the subscription is
      // - the set of keys which the client knows about and
      // - the set of keys it *wants* to know about.
      let workingQuery = qops.create()
      let pendingQuery = qops.create(initialQuery)

      // This is the subset of pendingQuery that we already know about.
      let _knownDocs = opts.knownDocs
        ? qops.intersectDocs(opts.knownDocs, pendingQuery)
        : qops.create()
      //let knownDocs = opts.knownDocs || qops.create()
      let knownAtV = opts.knownAtVersions || {}

      let nextCallbacks = null // lock for next.

      // TODO: Should we also have a version for the pending->working query status?
      // These names aren't ideal.
      const qv = [0, 0] // client query version. Aka, the user's intended query.
      const cv = [0, 0] // The version of workingQuery. Aka, the current active query.
      const versions = {} // Versions for the underlying source.


      // While we have an active catchup() function running we'll buffer up
      // server operations so when catchup returns we can apply any additional
      // ops we see before returning.
      //
      // null when we aren't buffering. A list when we are.
      let opsBuffer = null

      function next(callback) {
        // This catches up data from the store, with a constraint that the version of
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
        assert.equal(opsBuffer, null)
        opsBuffer = []

        let query, fromV
        if (!qops.isNoop(_knownDocs)) {
          query = _knownDocs
          fromV = knownAtV
        } else {
          query = pendingQuery
          fromV = {} // We have no knowledge.
        }

        // Pass opts.mode, opts.limitDocs and supportedTypes.
        catchup(qtype, query, fromV, opts, (err, data) => {
          if (err) return callback(err)

          const {results, queryRun, versions} = data

          // TODO: Implement me - Until I can produce these cases with tests,
          // there's no point implementing them. This code will come out broken
          // without unit tests.
          for (let s in versions) {
            assert(currentVersions[s] == null || currentVersions[s] === versions[s][1])
          }

          callback(err, data)
        })
      }


      const sub = { 
        _onOp(source, version, txn) {
          let update = null

          qops.eachTxnMatching(txn, workingQuery, (k, docop) => {
            if (update == null) update = new Map

            if (supportedTypes.has(docop.type))
              update.set(k, {type: docop.type, data: docop.data})
            else
              update.set(k, {type: 'set', data: docop.newVal})
          })

          let vs = versions[source]
          // If vs is null and there's no update, we're totally unconstrained. Discard.
          if (vs == null && update == null) return

          // If we have an update, update the lower bound no matter what.
          if (update != null) {
            if (vs == null) vs = versions[source] = [version, version]
            else vs[0] = version
          }
          // Always update the upper bound if vs exists.
          if (vs) vs[1] = version

          assert(update === null || update.size > 0)
          if (update || (opts.alwaysNotify && versions[source])) {
            // For txn updates we're guaranteed to only update the version from
            // one source. We just use this API for consistency with cursor
            // updates (below).
            //
            // If update isn't empty the lower range is updated.  The upper
            // range is always updated (although the notification won't be sent
            // at all if there's nothing to update and alwaysNotify isn't set)
            listener('txn', update || emptyMap, {[source]: vs}, sub)
          }
        },

        _modifySync(qop, newqv) {
          // TODO: How should this handle opts.noFetch?

          // We only need to update qv[0] here if the working set changes.
          if (newqv == null) newqv = qv[1] + 1
          else assert(newqv > qv[1])
          qv[1] = newqv

          // workingQuery and pendingQuery together they make up the sub's
          // query, and we need to edit both of them based on the operation.
          const [workOp, pendingOp] = qops.split(qop, workingQuery)

          // TODO: Its weird that I'm making an update with the actual query,
          // but not the intended query (_query). Should I be?
          let update = emptyMap
          let newVersions = {}

          if (!qops.isNoop(workOp)) {
            qv[0] = newqv

            // So there's an interesting problem here: If the 

            // We might also be able to weaken the other version
            // constraints, but that would require enough bookkeeping that its
            // not worth it.
            workingQuery = qops.apply(workingQuery, workOp)
            cv[0] = cv[1] = cv[1] + 1

            // And update the client that the active query has changed.
            if (opts.trackCursor) {
              update = new Map
              update.set('_cursor', {type: qops.type, data: workOp})
            }
            newVersions._cursor = cv
          }
          newVersions._query = qv

          if (!qops.isNoop(pendingOp)) {
            pendingQuery = qops.apply(pendingQuery, pendingOp)
            if (opts.knownDocs) _knownDocs = qops.intersectDocs(opts.knownDocs, pendingQuery)
          }

          listener('modify', update, newVersions, sub)
          //console.log('pending, work', pendingQuery, workingQuery)
        },

        // modify is called async so its semantics don't change if its being
        // called via a network stream or something. (regression)
        //
        // TODO: Consider wrapping this in the client with a function that
        // takes a callback. (Its useful.)
        modify(qop, newqv) {
          process.nextTick(() => this._modifySync(qop, newqv))
        },

        cursorNext(opts = {}, callback) {
          // TODO: Consider adding a query live-ness version number & operation
          // stream

          if (qops.isEmpty(pendingQuery)) { // nothing to do.
            //console.log('pending query empty', pendingQuery)
            return callback && callback()
          }

          if (nextCallbacks) {
            if (callback) nextCallbacks.add(callback)
            return
          }

          nextCallbacks = new Set
          if (callback) nextCallbacks.add(callback)

          // aka poll, this function fetches some more data from the store,
          // bound by the specified limit options to increase our working set
          // size.
          catchupAtCurrent(qtype, pendingQuery, {
            limitDocs: opts.limitDocs,
            limitBytes: opts.limitBytes
          }, (err, data) => {
            const done = (err) => {
              const cbs = nextCallbacks
              nextCallbacks = null
              for (const cb of cbs) cb(err)
            }

            if (err) return done(err)

            const newVersions = {}

            const {results, versions: resultVersions, queryRun} = data
            //console.log('fetch returned', data)

            // TODO: Should I do something special here if queryRun is empty?
            // Is that possible?

            for (let s in resultVersions) {
              const resultvs = resultVersions[s]
              const subvs = versions[s]

              if (subvs == null) {
                versions[s] = newVersions[s] = resultvs
              } else {
                if (resultvs[0] > subvs[0]) {
                  subvs[0] = resultvs[0]
                  newVersions[s] = resultvs // == subvs.
                }
                assert.strictEqual(subvs[1], resultvs[1]) // guaranteed by catchupAtCurrent.
              }
            }

            const update = new Map

            // Remove the fetched query range from the pending set...
            pendingQuery = qops.apply(pendingQuery, qops.asRemoveOp(queryRun))
            if (opts.knownDocs) _knownDocs = qops.intersectDocs(_knownDocs, pendingQuery)
            // ... and add them to the working set.
            workingQuery = qops.apply(workingQuery, qops.asAddOp(queryRun))

            // Not always needed but this is easier than bookkeeping
            if (qv[0] !== qv[1]) {
              qv[0] = qv[1]
              newVersions._query = qv
            }

            cv[1]++
            if (results.size > 0) cv[0] = cv[1]

            newVersions._cursor = cv
            if (opts.trackCursor) update.set('_cursor', {type: qops.type, data: workOp, newVal: workingQuery})

            // We need to convert the results we got into an update for the
            // client.
            // TODO: Not sure how to handle noFetch here.
            for (let [k, doc] of results) {
              if (this.data) this.data.set(k, doc)
              update.set(k, {type:'set', data:doc})
            }

            // TODO: ??? It might make sense to separate this from document updates.
            //update.set('_cursor', {type:qtype, data:qops.asAddOp(queryRun)})

            listener('cursor', update, newVersions, sub)
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

