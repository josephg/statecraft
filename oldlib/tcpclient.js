const assert = require('assert')
const es = require('event-stream')
const {Writable} = require('stream')

const queryops = require('../common/queryops')

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

const client = (stream, capabilities) => {
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
    //console.log('client sent', msg)
    if (stream.writable) stream.write(msg)
  }

  stream.on('data', msg => {
    //console.log('client got', msg)

    switch(msg.a) {
      case 'fetch': {
        const {ref, results, versions, queryRun, error} = msg
        const callback = takeCallback(ref)

        if (error) callback(Error(error))
        else callback(null, {results: new Map(results), versions, queryRun})
        break
      }

      case 'getops': {
        const {ref, data, error} = msg
        const callback = takeCallback(ref)

        if (error) callback(Error(error))
        else {
          data.ops.forEach(op => op.txn = new Map(op.txn))
          callback(null, data)
        }

        break
      }

      case 'sub txn': {
        const {ref, type, /*update,*/ newVersions, isComplete} = msg
        const update = new Map(msg.update)

        const sub = subByRef.get(ref)
        
        if (isComplete != null) sub._isComplete = isComplete

        sub._listener(type, update, newVersions, sub)

        if (type === 'next') {
          const cbs = sub._nextCallbacks
          sub._nextCallbacks = null
          for (const cb of cbs) cb() // TODO: Handle errors here.
        }
        break
      }

      case 'sub next': {
        const {ref, isComplete} = msg // TODO: error handling.
        const sub = subByRef.get(ref)

        if (isComplete != null) sub._isComplete = isComplete

        const callbacks = sub._nextCallbacks
        assert(callbacks != null)
        sub._nextCallbacks = null

        for (const cb of callbacks) cb()
        break
      }

      case 'sub error': {
        const {ref, error} = msg
        console.error('Subscribe error', error)
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
        console.error('s->c Message not implemented', msg.a, msg)
    }
  })

  stream.resume()

  const store = {
    capabilities,

    close() {
      // Not sure if this is the right way to do this.
      stream.removeAllListeners('data').end()
    },

    fetch(qtype, query, opts, callback) {
      assert(typeof callback === 'function')
      const ref = nextRef++
      callbackByRef.set(ref, callback)
      write({a:'fetch', ref, qtype, query, opts})
    },

    getOps(qtype, query, versions, opts, callback) {
      assert(typeof callback === 'function')
      const ref = nextRef++
      callbackByRef.set(ref, callback)
      write({a:'getops', ref, qtype, query, versions, opts})
    },

    subscribe(qtype, query, reqVersions={}, opts={}, listener) {
      const ref = nextRef++

      const qops = queryops[qtype]
      assert(qops, `Query type ${qtype} not supported by client library`)

      // Proxy subscription object.
      const sub = {
        _listener: listener,
        _nextCallbacks: null,

        _isComplete: false,
        isComplete() { return this._isComplete },

        cancel() {
          write({a:'sub cancel', ref})
        },

        modify(qop, qversion) {
          write({a:'sub modify', ref, qop, qversion})
        },

        cursorNext(opts, callback) {
          // TODO: Add a network-driven automatic pump to this.
          if (this._nextCallbacks) {
            if (callback) this._nextCallbacks.add(callback)
            return
          }

          this._nextCallbacks = new Set
          if (callback) this._nextCallbacks.add(callback)
          write({a:'sub next', ref, opts})
        }
      }

      subByRef.set(ref, sub)
      write({a:'sub', qtype, ref, query, versions: reqVersions, opts})

      return sub
    },

    mutate(txn, versions, opts, callback) {
      const ref = nextRef++
      callbackByRef.set(ref, callback)
      write({a:'mutate', ref, txn:Array.from(txn), versions, opts})
    },
  }

  return store
}

const convertCapabilities = (clists) => {
  const out = {}
  for (let k in clists) out[k] = new Set(clists[k])
  return out
}

const clientAwaitingHello = (stream, callback) => {
  stream.once('data', (hellomsg) => {
    //console.log('hello', hellomsg)
    if (hellomsg.a !== 'hello') return protocolError(stream, Error('Expected hello message'))

    // The message specifies supported query types and OT types.
    const {pv, capabilities} = hellomsg // TODO: Add protocol version.
    if (!typeof capabilities === 'object') return protocolError(stream, Error('Invalid hello message'))
    if (pv !== 1) return protocolError(stream, Error(`Unexpected protocol version ${pv}`))

    stream.pause() // Make sure the proper listener above gets subsequent messages
    callback(null, client(stream, convertCapabilities(capabilities)))
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