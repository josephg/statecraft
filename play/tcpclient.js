const assert = require('assert')
const es = require('event-stream')
const {Writable} = require('stream')
const resultset = require('./resultset')

function resultsAsMap(obj) {
  if (obj.constructor === Map) return obj

  const m = new Map
  for (let k in obj) {
    m.set(k, obj[k])
  }
  return m
}

function resolvable(callback) {
  // Invert a promise.
  let resolve, reject
  const promise = new Promise((_resolve, _reject) => {
    resolve = _resolve
    reject = _reject
  })

  if (callback) promise.then(data => callback(null, data), callback)
  return (err, data) => {
    if (err) reject(err)
    else resolve(data)
  }
}

const client = (stream) => {
  //stream.write({a:"fetch",query:[["a","b"]],versions:{}})

  const pendingByRef = new Map
  const subByRef = new Map
  let nextRef = 1

  const write = (msg) => {
    if (stream.writable) stream.write(msg)
  }

  stream.on('data', msg => {
    //console.log('client got', msg)

    switch(msg.a) {
      case 'fetch': {
        const {ref, results, versions, error} = msg
        const callback = pendingByRef.get(ref)

        if (error) callback(Error(error))
        else callback(null, {results: new Map(results), versions})

        pendingByRef.delete(ref)
        break
      }

      case 'sub': {
        // The provided callback is a shorthand for modifySub, so this looks
        // mighty similar to modifySub below
        const {ref, version} = msg
        const callback = pendingByRef.get(ref)
        if (callback) {
          pendingByRef.delete(ref)
          callback(null, version)
        }
        break
      }

      case 'modifySub': {
        const {ref, version, error} = msg
        const sub = subByRef.get(ref)
        const callback = sub._modifyCallbacks.get(version)
        if (callback) {
          sub._modifyCallbacks.delete(version)
          callback(null, version)
        }
        break
      }

      case 'txn': {
        const {ref, versions} = msg
        const data = new Map(msg.data)
        const sub = subByRef.get(ref)
        sub.versions = versions // TODO: Should I store the whole thing or send patches?
        
        //console.log('got txn', sub.data, data)
        if (!sub.opts.raw) sub.data = resultset.type.apply(sub.data, data)

        sub.emit('txn', data, versions)

        break
      }

      case 'cancelSub': {
        const {ref, error} = msg
        if (error) {
          console.warn('Error cancelling sub', ref, error)
        }
        subByRef.delete(ref)
        break
      }

      default:
        console.error('Message not implemented', msg.a, msg)
    }
  })

  return {
    fetch(queryType, query, versions, callback) {
      const ref = nextRef++
      pendingByRef.set(ref, resolvable(callback))
      write({a:'fetch', queryType, ref, query, versions})
    },

    subscribe(queryType, query, reqVersions={}, opts={}, listener, callback) {
      const ref = nextRef++
      if (callback) pendingByRef.set(ref, resolvable(callback))

      // Proxy subscription object.
      const EventEmitter = require('events')
      const sub = new EventEmitter()

      if (!opts.raw) sub.data = resultset.type.create()
      if (opts.cv == null) opts.cv = 0
      let lastCV = opts.cv

      if (!opts.raw) {
        if (opts.supportedTypes) {
          // Trim to the types known by resultset
          for (let t of opts.supportedTypes) if (!resultset.supportedTypes.has(t)) {
            // We don't support the type, so strip it out of the requested type set.
            console.warn(`Removing requested op type ${t} - not supported out of raw mode`)
            opts.supportedTypes.delete(t)
          }
        } else {
          opts.supportedTypes = Array.from(resultset.supportedTypes)
        }
      }

      sub.opts = opts // ?? Why do we need this?
      sub.versions = {}
      sub.cancel = () => {
        stream.write({a:'cancelSub', ref})
      }

      sub._modifyCallbacks = new Map
      sub.modify = (op, version, callback) => {
        if (typeof version === 'function') [version, callback] = [null, version]
        
        if (version == null) {
          version = ++lastCV
        } else {
          assert(version > lastCV)
          lastCV = version
        }
        stream.write({a:'modifySub', ref, op, version})
        // Gross using a string here as the key - but whatever.
        if (callback) sub._modifyCallbacks.set(version, resolvable(callback))
      }

      if (listener) sub.on('txn', listener)

      subByRef.set(ref, sub)
      stream.write({a:'sub', queryType, ref, query, versions: reqVersions, opts})
      return sub
    },

    // TODO: Consider wrapping the client we return in a promise or something,
    // and wait until we get the hello message before allowing any of this
    // stuff to get called.
    fetchKV(...args) { this.fetch('kv', ...args) },
    fetchSKV(...args) { this.fetch('sortedkv', ...args) },

    subscribeKV(...args) { return this.subscribe('kv', ...args) },
    subscribeSKV(...args) { return this.subscribe('sortedkv', ...args) },
  }
}

exports.tcpClient = function(port, host) {
  const net = require('net')
  
  const c = net.createConnection(port, host, () => {
    console.log('connected')


    //c.write('{"a":"fetch","query":[["a","b"]],"versions":{}}\n')
  })

  const write = es.stringify()
  write.pipe(c)

  const read = c.pipe(es.split()).pipe(es.parse())

  return client(es.duplex(write, read))
}


/*
const s = exports.tcpClient(5747)
//s.fetch([['a', 'b']], {}, (err, data) => {
s.streamOps([['a', 'z']], {}, d => {console.log(d)}, (err, data) => {
  console.log(err, data)

  setTimeout(() => {data.cancel()}, 5000)
})
*/
