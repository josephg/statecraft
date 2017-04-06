// This module maps all the data returned by a store through a syncronous
// mapping function.
//
// TODO: Make an async version of this.

const assert = require('assert')

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

// Function should have the signature of (value, key) => value.
module.exports = (store, fn) => {
  const wrapped = {
    supportedQueryTypes: store.supportedQueryTypes,

    fetch(qtype, docs, opts, callback) {
      store.fetch(qtype, docs, opts, (err, data) => {
        if (err) return callback(err)

        mapMut(data.results, fn)
        return callback(null, data)
      })
    },

    subscribe(qtype, query, versions, outerOpts, outerListener) {
      const opts = Object.assign({}, outerOpts)
      opts.supportedTypes = [] // We only map on values here, so flatten everything to sets and rms.
      
      const listener = (type, outerUpdate, versionUpdate) => {
        // TODO: Not sure what to do with special operations (like _cursor).
        // Currently they'll get flattened with everything else.
        outerListener(type, mapUpdate(outerUpdate, fn), versionUpdate)
      }

      const innerSub = store.subscribe(qtype, query, versions, opts, listener)

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
