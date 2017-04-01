// This is a simple wrap around a data source which scopes in all accesses to a
// particular part of the KV tree.

const assert = require('assert')
const rangeutil = require('./rangeutil')

const mapKeys = (collection, fn) => {
  if (Array.isArray(collection)) return collection.map(fn)
  else if (collection.constructor === Set) {
    const result = new Set
    for (let x of collection) result.add(fn(x))
    return result
  } else if (collection.constructor === Map) {
    // Here in lens land we're all about editing keys. So this modifies the
    // keys in the map.
    const result = new Map
    for (let [k, v] of collection) result.set(fn(k), v)
    return result
  } else throw Error('Cannot map over unsupported collection', collection)
}

module.exports = (store, prefix) => {
  const supportedQueryTypes = {}
  ;['kv', 'sortedkv'].forEach(t => {
    if (store.supportedQueryTypes[t]) supportedQueryTypes[t] = true
  })

  const addPrefix = name => prefix + name
  const stripPrefix = name => {
    assert(name.indexOf(prefix) === 0) // Probably faster than slicing.
    return name.slice(prefix.length)
  }

  const prefixQuery = (qtype, outerQuery) => {
    if (qtype === 'kv') return mapKeys(outerQuery, addPrefix)
    else if (qtype === 'sortedkv') return rangeutil.addPrefix(outerQuery, prefix)
    else throw Error('Unsupported query type ' + qtype)
  }

  const prefixQueryOp = (qtype, outerOp) => {

  }

  return {
    supportedQueryTypes,

    fetch(qtype, outerQuery, versions, options = {}, callback) {
      store.fetch(qtype, prefixQuery(qtype, outerQuery), versions, options, (err, data) => {
        if (err) return callback(err)
        const {results, versions} = data
        callback(null, {results:mapKeys(results, stripPrefix), versions})
      })
    },
    
    subscribe(qtype, initialQuery, versions, opts = {}, outerListener, callback) {
      const listener = () => {}

      const innerSub = store.subscribe(
        qtype, prefixQuery(qtype, initialQuery), versions, opts, listener, callback)
    },

    mutate(txn, versions, options = {}, callback = doNothing) {
    },
    
    close() {
      // TODO: We need a way to refcount the store.
      store.close()
    },
  }

}
