// This module maps all the data returned by a store through a syncronous
// mapping function.
//
// TODO: Make an async version of this.

const assert = require('assert')
const {filterCapabilities} = require('./util')

// TODO: Consider moving these into resultset.js.
const mapMut = (map, fn) => {
  for (const [k, v] of map) map.set(k, fn(v, k))
  return map
}

const mapUpdate = (update, fn) => {
  const result = new Map
  for (const [k, docop] of update) {
    if (docop.type === 'set') {
      result.set(k, {type:'set', data:fn(docop.data, k)})
    } else (assert(docop.type === 'rm', `Got unmappable docop type ${docop.type}`))
  }
  return result
}

const supportedTypes = new Set(['rm', 'set'])
const wrapOpts = (outerOpts) => {
  const opts = Object.assign({}, outerOpts)
  opts.supportedTypes = supportedTypes // We only map on values here, so flatten everything to sets and rms.
  return opts
}

const capabilities = {
  mutationTypes: new Set(), // Mutation is not supported through the map.
  opTypes: new Set([]), // Don't allow any operations except for the standard ones.
  queryTypes: null,
}

// Function should have the signature of (value, key) => value.
module.exports = (store, fn) => {
  const wrapped = {
    capabilities: filterCapabilities(store.capabilities, capabilities),

    fetch(qtype, docs, opts, callback) {
      store.fetch(qtype, docs, opts, (err, data) => {
        if (err) return callback(err)

        if (!opts.noDocs) mapMut(data.results, fn)
        return callback(null, data)
      })
    },

    getOps(qtype, query, versions, opts, callback) {
      store.getOps(qtype, query, versions, wrapOpts(opts), (err, ops) => {
        if (err) return callback(err)
        // This is a pipeline, so I can get away with editing the list in-place
        ops.forEach(op => op.txn = mapUpdate(op.txn, fn))
        return callback(null, ops)
      })
    },

    subscribe(qtype, query, versions, outerOpts, outerListener) {
      const listener = (type, outerUpdate, versionUpdate) => {
        // TODO: Not sure what to do with special operations (like _cursor).
        // Currently they'll get flattened with everything else.
        outerListener(type, outerOpts.noDocs ? mapUpdate(outerUpdate, fn) : outerUpdate, versionUpdate)
      }

      const innerSub = store.subscribe(qtype, query, versions, wrapOpts(outerOpts), listener)

      // TODO: Make a proxy class or something to make writing this easier.
      return {
        modify(qop) { innerSub.modify(qop) },
        cursorNext(opts, callback) { innerSub.cursorNext(opts, callback) },
        isComplete() { return innerSub.isComplete() },
        cancel() { innerSub.cancel() },
      }
    },
  }
 
  ;['close', 'mutate'].forEach(m => {
    wrapped[m] = (...args) => store[m](...args)
  })

  return wrapped

}
