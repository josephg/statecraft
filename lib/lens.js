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

  const queryops = {kv:{}, sortedkv:{}}

  queryops.kv.prefixQuery = outerQuery => mapKeys(outerQuery, addPrefix)
  queryops.sortedkv.prefixQuery = outerQuery => rangeutil.addPrefix(outerQuery, prefix)

  queryops.kv.prefixQueryOp = outerOp => {
    const result = {}
    if (outerOp.add) result.add = outerOp.add.map(k => addPrefix(k))
    if (outerOp.remove) result.remove = outerOp.remove.map(k => addPrefix(k))
    return result
  }
  queryops.sortedkv.prefixQueryOp = queryops.sortedkv.prefixQuery


  return {
    supportedQueryTypes,

    fetch(qtype, outerQuery, options = {}, callback) {
      store.fetch(qtype, queryops[qtype].prefixQuery(outerQuery), options, (err, data) => {
        if (err) return callback(err)
        const out = Object.assign({}, data)
        out.results = mapKeys(data.results, stripPrefix)
        callback(null, out)
      })
    },

    getOps(qtype, outerQuery, versions, opts, callback) {
      store.getOps(qtype, queryops[qtype].prefixQuery(outerQuery), versions, opts, (err, ops) => {
        if (err) return callback(err)
        ops.forEach(op => op.txn = mapKeys(op.txn, stripPrefix))
        callback(null, ops)
      })
    },
    
    subscribe(qtype, initialQuery, versions, opts = {}, outerListener) {
      const qops = queryops[qtype]
      assert(qops, 'Unsupported query type')

      const listener = (type, innerUpdate, versionUpdate) => {
        outerListener(type, mapKeys(innerUpdate, stripPrefix), versionUpdate)
      }

      const innerSub = store.subscribe(qtype, qops.prefixQuery(initialQuery), versions, opts, listener)

      const sub = {
        modify(outerQop) { innerSub.modify(qops.prefixQueryOp(outerQop)) },
        cursorNext(opts, callback) { innerSub.cursorNext(opts, callback) },
        isComplete() { return innerSub.isComplete() },
        cancel() { innerSub.cancel() }
      }

      return sub
    },

    mutate(txn, versions, options, callback) {
      store.mutate(mapKeys(txn, addPrefix), versions, options, callback)
    },
    
    close() {
      // TODO: We need a way to refcount the store.
      store.close()
    },
  }

}
