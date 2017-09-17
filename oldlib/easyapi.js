// This is a simple tool to augment any statecraft store with a bunch of
// utility methods.
//
// TODO: Should I wrap the store instead of adding these functions via mixins?

const doNothing = () => {}

module.exports = function(store) {
  store.set = function(key, value, versions, callback) {
    // Versions and callback are optional.
    if (typeof versions === 'function') [versions, callback] = [{}, versions]

    const txn = new Map([[key, {type:'set', data:value}]])
    // Callback called with (error, resulting version(s))
    this.mutate(txn, versions || {}, {}, callback || doNothing)
  }

  store.delete = function(key, versions, callback) {
    // Versions and callback are optional.
    if (typeof versions === 'function') [versions, callback] = [{}, versions]

    const txn = new Map([[key, {type:'rm'}]])
    // Callback called with (error, resulting version(s))
    this.mutate(txn, versions || {}, {}, callback || doNothing)
  }

  if (store.capabilities.queryTypes.kv) {
    store.fetchKV = function(...args) { this.fetch('kv', ...args) }
    store.subscribeKV = function(...args) { this.subscribe('kv', ...args) }
  }

  if (store.capabilities.queryTypes.sortedkv) {
    store.fetchSKV = function(...args) { this.fetch('sortedkv', ...args) }
    store.subscribeSKV = function(...args) { this.subscribe('sortedkv', ...args) }
  }

  store.get = function(key, callback) {
    this.fetch('kv', [key], {}, (err, data) => {
      if (err) return callback(err)
      const {results, versions} = data
      const value = results.get(key)
      callback(null, value, versions)
    })
  }

  const innerSubscribe = store.subscribe.bind(store)
  
  store.subscribe = (...args) => {
    const sub = innerSubscribe(...args)

    sub.cursorAll = function(opts = {}, callback = doNothing) {
      if (typeof opts === 'function') [opts, callback] = [{}, opts]

      if (sub.isComplete()) return callback()
      else sub.cursorNext(opts, err => {
        if (err) return callback(err)
        sub.cursorAll(opts, callback)
      })
    }

    return sub
  }

  store.trackingSub = require('./trackingsub')(store.subscribe)

  return store
}