const es = require('event-stream')
const {Writable} = require('stream')
const {normalizeRanges} = require('./util')

const resultsAsObj = (res) => {
  if (res.constructor === Map) {
    const obj = {}
    for (let [k, v] of res) {
      obj[k] = v
    }
    return obj
  } else {
    return res
  }
}

/* Protocol
 *
 * Fetch:
 * C: {a:'fetch', query:_, versions:_, ref:_}
 * S: {a:'fetch', ref:_, results:_, versions:_}
 * or
 * S: {a:'fetch', ref:_, error:_}
 *
 *
 */

// Copy pasta
// {"a":"fetch","query":[["a","b"]],"versions":{}}
// {"a":"streamOps","ref":1,"versions":{},"query":[["a","b"]]}
// {"a":"cancelStream","ref":1}


const serve = (client, source) => {
  let finished = false
  client.on('finish', () => {finished = true})
  const write = msg => {
    if (!finished && client.writable) client.write(JSON.stringify(msg)+'\n')
  }

  const protoErr = err => {
    console.log('Invalid client', err)
    //client.close()
  }

  const streamsByRef = new Map

  client.on('data', (msg) => {
    switch(msg.a) {
      case 'fetch': {
        const {query, versions, ref} = msg
        source.fetch(query, versions, (err, data) => {
          if (err) {
            console.error('Error in fetch', query, versions, err)
            return write({a:'fetch', ref, error: err.message})
          }

          write({a:'fetch', ref, results: resultsAsObj(data.results), versions: data.versions})
        })
        break
      }

      case 'streamOps': {
        const {query, versions, ref} = msg
        const listener = (data) => {
          if (!streamsByRef.has(ref)) return

          data = resultsAsObj(data)
          write({a:'stream', ref, results: data})
        }

        streamsByRef.set(ref, null)
        source.streamOps(query, versions, listener, (err, stream) => {
          if (err) {
            console.error('Error subscribing', query, versions, err)
            return write({a:'streamOps', ref, error: err.message})
          }

          const {versions, cancel} = stream
          if (streamsByRef.get(ref) !== null) {
            // Stream was deleted
            cancel()
          }
          write({a:'streamOps', ref, versions, status: 'ok'})
          streamsByRef.set(ref, stream)
        })
        break
      }

      case 'cancelStream': {
        const {ref} = msg
        if (!streamsByRef.has(ref)) {
          return write({a:'cancelStream', ref, error: 'Ref not found'})
        }

        const s = streamsByRef.get(ref)
        if (s !== null) {
          s.cancel()
        }
        streamsByRef.delete(ref)
        write({a:'cancelStream', ref, status: 'ok'})
        break
      }

      default:
        console.error('Invalid msg.a', msg.a)
        protoErr('Invalid request')
    }
  })
}

exports.tcpServer = function(source) {
  const net = require('net')

  return net.createServer(c => {
    console.log('got client')
    serve(es.duplex(c, c.pipe(es.split()).pipe(es.parse())), source)
  })
}

/*
server.listen(4444, () => {
  console.log('listening on 4444')
})*/
