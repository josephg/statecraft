const assert = require('assert')
const es = require('event-stream')
const {Writable} = require('stream')
const resultset = require('./resultset')

const listToObjMap = list => {
  const obj = {}
  for (let i = 0; i < list.length; i++) obj[list[i]] = true
  return obj
}

const protocolError = (stream, error) => {
  // The remote peer did something unexpected. Turf them.
  console.warn('Error processing message from remote client:', error)
  stream.removeAllListeners('data').end()
}

const client = (stream, queryTypes, opTypes) => {
  //stream.write({a:"fetch",query:[["a","b"]],versions:{}})

  const callbackByRef = new Map
  const takeCallback = ref => {
    const cb = callbackByRef.get(ref)
    callbackByRef.delete(ref)
    return cb
  }

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
        const callback = takeCallback(ref)

        if (error) callback(Error(error))
        else callback(null, {results: new Map(results), versions})
        break
      }

      case 'sub': {
        // The provided callback is a shorthand for modifySub, so this looks
        // mighty similar to modifySub below
        const {ref, versions, cv} = msg

        // TODO: Do we need to attach other properties to the sub?
        const sub = subByRef.get(ref)
        sub.versions = versions

        const callback = takeCallback(ref)
        if (callback) callback(null, cv)
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

      case 'mutate': { // Response to issuing a mutation
        const {ref, error, versions} = msg
        const callback = takeCallback(ref)
        if (error) callback(Error(error))
        else callback(null, versions)
        break
      }

      default:
        console.error('Message not implemented', msg.a, msg)
    }
  })

  stream.resume()

  const store = {
    supportedQueryTypes: queryTypes,

    close() {
      // Not sure if this is the right way to do this.
      stream.removeAllListeners('data').end()
    },

    fetch(queryType, query, versions, opts, callback) {
      const ref = nextRef++
      callbackByRef.set(ref, callback)
      write({a:'fetch', queryType, ref, query, versions, opts})
    },

    subscribe(queryType, query, reqVersions={}, opts={}, listener, callback) {
      const ref = nextRef++
      if (callback) callbackByRef.set(ref, callback)

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
      sub.versions = null // Set before the callback returns
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
        if (callback) sub._modifyCallbacks.set(version, callback)
      }

      if (listener) sub.on('txn', listener)

      subByRef.set(ref, sub)
      stream.write({a:'sub', queryType, ref, query, versions: reqVersions, opts})
      return sub
    },

    mutate(txn, versions, opts, callback) {
      const ref = nextRef++
      callbackByRef.set(ref, callback)
      write({a:'mutate', ref, txn:Array.from(txn), versions, opts})
    },
  }

  // Or just leave all the methods here but throw if they get called.
  for (let qt in queryTypes) {
    const fn = ({kv: 'KV', sortedkv: 'SKV'})[qt]
    store[`fetch${fn}`] = function(...args) { this.fetch(qt, ...args) }
    store[`subscribe${fn}`] = function(...args) { return this.subscribe(qt, ...args) }
  }

  return store
}

const clientAwaitingHello = (stream, callback) => {
  stream.once('data', (hellomsg) => {
    //console.log('hello', hellomsg)
    if (hellomsg.a !== 'hello') return protocolError(stream, Error('Expected hello message'))

    // The message specifies supported query types and OT types.
    const {pv, queryTypes, opTypes} = hellomsg // TODO: Add protocol version.
    if (!queryTypes || !opTypes) return protocolError(stream, Error('Invalid hello message'))
    if (pv !== 1) return protocolError(stream, Error(`Unexpected protocol version ${pv}`))

    stream.pause() // Make sure the proper listener above gets subsequent messages
    callback(null, client(stream, listToObjMap(queryTypes), listToObjMap(opTypes)))
  })
}

exports.tcpClient = function(port, host, callback) {
  const net = require('net')
  
  const c = net.createConnection(port, host, () => {
    //console.log('connected')


    //c.write('{"a":"fetch","query":[["a","b"]],"versions":{}}\n')
  })

  const write = es.stringify()
  write.pipe(c)

  const read = c.pipe(es.split()).pipe(es.parse())

  clientAwaitingHello(es.duplex(write, read), callback)
}


/*
const s = exports.tcpClient(5747)
//s.fetch([['a', 'b']], {}, (error, data) => {
s.streamOps([['a', 'z']], {}, d => {console.log(d)}, (error, data) => {
  console.log(error, data)

  setTimeout(() => {data.cancel()}, 5000)
})
*/
