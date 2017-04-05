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
    fetch(qtype, docs, versions, options, callback) {
      if (qtype !== 'kv') return store.fetch(qtype, docs, versions, options, callback)

      // Just convert the query to a range query and use the range query
      // implementation.
      const ranges = rangeops.fromKeys(docs)
      this.fetch('sortedkv', ranges, versions, options, callback)
    },

    subscribe(qtype, initialKV, versions, opts = {}, outerlistener) {
      if (qtype !== 'kv') return store.subscribe(qtype, initialKV, versions, opts, outerlistener)

      let innerSub, sub

      const listener = (type, update, versionUpd) => {
        // This might not be necessary because the .data object is reused in
        // the root store anyway.
        if (innerSub.data) sub.data = innerSub.data
        sub.versions = innerSub.versions // might be better to copy from version update.
        outerlistener(type, update, versionUpd)
      }

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

      if (innerSub.data) sub.data = innerSub.data
      sub.versions = innerSub.versions

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

