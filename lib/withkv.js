// This is a simple store wrapper which wraps any SKV store to also support KV
// queries.
//
// It works by translating KV queries to SKV queries - since SKV queries
// support a superset of the KV operations.

const rangeops = require('../common/rangeops')
const setops = require('../common/setops')

module.exports = function wrap(store) {
  if (store.capabilities.queryTypes.has('kv')) return store // Already done.

  if (!store.capabilities.queryTypes.has('sortedkv')) {
    throw Error('Can only add KV support to stores which support SVK')
  }

  const capabilities = Object.assign({}, store.capabilities)
  capabilities.queryTypes = new Set(store.capabilities.queryTypes)
  capabilities.queryTypes.add('kv')

  const wrapped = {
    capabilities,

    // Query is a list of keys or a set.
    fetch(qtype, docs, opts, callback) {
      if (qtype !== 'kv') return store.fetch(qtype, docs, opts, callback)

      // Just convert the query to a range query and use the range query
      // implementation.
      const ranges = rangeops.fromKeys(docs)
      store.fetch('sortedkv', ranges, opts, callback)
    },

    getOps(qtype, query, versions, opts, callback) {
      if (qtype !== 'kv') return store.fetch(qtype, docs, opts, callback)
      store.getOps('sortedkv', rangeops.fromKeys(query), versions, opts, callback)
    },

    subscribe(qtype, initialKV, versions, opts = {}, listener) {
      if (qtype !== 'kv') return store.subscribe(qtype, initialKV, versions, opts, listener)

      let innerSub, sub

      innerSub = store.subscribe('sortedkv', rangeops.fromKeys(initialKV), versions, opts, listener)
      sub = {
        modify(kvop) {
          // Op is a set op. Convert to a range op.
          const skvop = rangeops.compose(
            rangeops.fromKeys(op.remove || [], -1),
            rangeops.fromKeys(op.add || [], 1)
          )

          innerSub.modify(skvop)
        },

        cursorNext(opts, callback) { innerSub.cursorNext(opts, callback) },
        isComplete() { return innerSub.isComplete() },
        cancel() { innerSub.cancel() },
      }

      return sub
    },
  }

  // Methods to copy directly.
  // TODO: Support copying more query types when we have them!
  
  ;['close', 'mutate'].forEach(m => {
    wrapped[m] = (...args) => store[m](...args)
  })

  return wrapped
}

