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

const prefixFor = { kv: 'KV', sortedkv: 'SVK' }

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

  const fetch = (queryType, ...args) => {
    const fetchfn = ({kv: source.fetchKV, sortedkv: source.fetchSVK})[queryType]
    fetchfn(...args)
  }

  const subscribe = (queryType, ...args) => {
    const subfn = ({kv: source.subscribeKV, sortedkv: source.subscribeSKV})[queryType]
    subfn(...args)
  }

  // First we send the client a capabilities message.
  write({a:'hello', queryTypes:['kv', 'sortedkv'], opTypes:['json1']}) // TODO.

  client.on('data', (msg) => {
    switch(msg.a) {
      case 'fetch': {
        const {queryType, query, versions, ref} = msg
        fetch(queryType, query, versions, (err, data) => {
          if (err) {
            console.error('Error in fetch', query, versions, err)
            return write({a:'fetch', ref, error: err.message})
          }

          write({a:'fetch', ref, results: resultsAsObj(data.results), versions: data.versions})
        })
        break
      }

      case 'sub': {
        
        break;
      }

      default:
        console.error('Invalid msg.a', msg.a)
        protoErr('Invalid request')
    }
  })
}

exports.tcpServer = function(source) {
  const net = require('net')
  const es = require('event-stream')

  return net.createServer(c => {
    console.log('got client')
    serve(es.duplex(c, c.pipe(es.split()).pipe(es.parse())), source)
  })
}

/*
server.listen(4444, () => {
  console.log('listening on 4444')
})*/
