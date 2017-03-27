// This is a simple store wrapper which wraps any SKV store to also support KV
// queries.
//
// It works by translating KV queries to SKV queries - since SKV queries
// support a superset of the KV operations.

const rangeops = require('../common/rangeops')
const setops = require('../common/setops')

module.exports = function wrap(store) {
  if (store.supportedQueryTypes.kv) return store // Already done.

  if (!store.supportedQueryTypes.sortedkv) {
    throw Error('Can only add KV support to stores which support SVK')
  }

  const supportedQueryTypes = Object.assign({kv:true}, store.supportedQueryTypes)
  const wrapped = {
    supportedQueryTypes: supportedQueryTypes,

    // Query is a list of keys or a set.
    fetchKV(docs, versions, options, callback) {
      // Just convert the query to a range query and use the range query
      // implementation.
      const ranges = rangeops.fromKeys(docs)
      this.fetchSKV(ranges, versions, options, callback)
    },

    subscribeKV(initialKV, versions, opts = {}, outerlistener, callback) {
      const initialSKV = rangeops.fromKeys(initialKV)

      let innerSub, sub

      const listener = (diff, versions) => {
        // This might not be necessary because the .data object is reused in
        // dbroot anyway.
        if (sub != null) { // Check might not be necessary
          if (innerSub.data) sub.data = innerSub.data
          sub.versions = innerSub.versions
        }
        outerlistener(diff, versions)
      }

      innerSub = store.subscribeSKV(initialSKV, versions, opts, listener, callback)
      sub = {
        opts: innerSub.opts,

        cancel() { innerSub.cancel() },
        
        modify(kvop, newCV, callback) {
          // Op is a set op. Convert to a range op.
          const skvop = rangeops.compose(
            rangeops.fromKeys(op.remove || [], -1),
            rangeops.fromKeys(op.add || [], 1)
          )

          innerSub.modify(skvop, newCV, callback)
        }
      }

      if (innerSub.data) sub.data = innerSub.data
      sub.versions = innerSub.versions

      return innerSub
    }
  }

  // Methods to copy directly.
  // TODO: Support copying more query types when we have them!
  
  ;['close', 'mutate', 'fetchSKV', 'subscribeSKV'].forEach(m => {
    wrapped[m] = (...args) => store[m](...args)
  })

  return wrapped
}

