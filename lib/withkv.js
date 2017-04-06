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
    fetch(qtype, docs, options, callback) {
      if (qtype !== 'kv') return store.fetch(qtype, docs, options, callback)

      // Just convert the query to a range query and use the range query
      // implementation.
      const ranges = rangeops.fromKeys(docs)
      this.fetch('sortedkv', ranges, options, callback)
    },

    subscribe(qtype, initialKV, versions, opts = {}, listener) {
      if (qtype !== 'kv') return store.subscribe(qtype, initialKV, versions, opts, listener)

      let innerSub, sub

      innerSub = store.subscribe('sortedkv', rangeops.fromKeys(initialKV), versions, opts, listener)
      sub = {
        opts: innerSub.opts,

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

      require('./subutil')(sub) // add getAll function

      return sub
    }
  }

  // Methods to copy directly.
  // TODO: Support copying more query types when we have them!
  
  ;['close', 'mutate'].forEach(m => {
    wrapped[m] = (...args) => store[m](...args)
  })

  return wrapped
}

