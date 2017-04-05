// This is a simple wrap around a data source which scopes in all accesses to a
// particular part of the KV tree.

const assert = require('assert')
const rangeutil = require('./rangeutil')
const resultset = require('./resultset')

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

    fetch(qtype, outerQuery, versions, options = {}, callback) {
      store.fetch(qtype, queryops[qtype].prefixQuery(outerQuery), versions, options, (err, data) => {
        if (err) return callback(err)
        const out = Object.assign({}, data)
        out.results = mapKeys(data.results, stripPrefix)
        callback(null, out)
      })
    },
    
    subscribe(qtype, initialQuery, versions, outerOpts = {}, outerListener) {
      const qops = queryops[qtype]
      assert(qops, 'Unsupported query type')

      let sub, innerSub

      const listener = (type, update, versionUpdate) => {
        // The version is boring, just copy it.
        sub.version = innerSub.version
        const outerUpdate = mapKeys(update, stripPrefix)
        if (sub.data) resultset.type.applyMut(sub.data, outerUpdate)
        outerListener(type, outerUpdate, versionUpdate)
      }

      const innerOpts = Object.assign({}, outerOpts)
      innerOpts.raw = true

      innerSub = store.subscribe(qtype, qops.prefixQuery(initialQuery), versions, innerOpts, listener)

      sub = {
        versions: innerSub.versions, // depends on the versions object staying.. Not sure if this is fair.
        data: outerOpts.raw ? null : new Map,

        modify(outerQop) { innerSub.modify(qops.prefixQueryOp(outerQop)) },
        cursorNext(opts, callback) { innerSub.cursorNext(opts, callback) },
        isComplete() { return innerSub.isComplete() },
        cancel() { innerSub.cancel() }
      }

      return require('./subutil')(sub) // add getAll
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
