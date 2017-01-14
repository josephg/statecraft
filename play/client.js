const assert = require('assert')
const es = require('event-stream')
const {Writable} = require('stream')

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
  const streamByRef = new Map
  let nextRef = 1

  const write = (msg) => {
    if (stream.writable) stream.write(msg)
  }

  stream.on('data', msg => {
    console.log('got', msg)

    switch(msg.a) {
      case 'fetch': {
        const {ref, results, versions, error} = msg
        const callback = pendingByRef.get(ref)

        if (error) callback(Error(error))
        else callback(null, {results, versions})

        pendingByRef.delete(ref)
        break
      }

      case 'streamOps': {
        // We've gotten a response about a streamOps request
        const {ref, versions, error} = msg
        const callback = pendingByRef.get(ref)

        // TODO: Missing the case where the stream ends naturally.
        if (error) {
          callback(Error(error))
          streamByRef.delete(ref)
          return
        }

        callback(null, {versions, cancel() {
          write({a:'cancelStream', ref})
          streamByRef.delete(ref)
        }})
        break
      }
      case 'cancelStream': {
        const {ref, error} = msg
        if (error) {
          console.warn('Error cancelling stream', ref, error)
        }
        break
      }
      case 'stream': {
        // We actually got a message on a stream.
        const {ref, results} = msg
        const listener = streamByRef.get(ref)
        if (!listener) return

        listener(resultsAsMap(results))
        break
      }
      default:
        console.error('Message not implemented', msg.a, msg)
    }
  })

  return {
    fetch(query, versions, callback) {
      const ref = nextRef++
      pendingByRef.set(ref, resolvable(callback))
      write({a:'fetch', ref, query, versions})
    },
    streamOps(query, versions, listener, callback) {
      const ref = nextRef++
      pendingByRef.set(ref, resolvable(callback))
      streamByRef.set(ref, listener)
      stream.write({a:'streamOps', ref, query, versions})
    },
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

  setTimeout(() => {data.cancel()}, 2000)
})
*/
