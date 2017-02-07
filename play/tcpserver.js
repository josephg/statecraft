const assert = require('assert')
const {Writable} = require('stream')
const {normalizeRanges} = require('./util')

/* Protocol
 *
 * Fetch:
 * C: {a:'fetch', queryType:'kv', ref:_, query:_, versions:_}
 * S: {a:'fetch', queryType:'kv', ref:_, results:_, versions:_}
 * or
 * S: {a:'fetch', ref:_, error:_}
 *
 *
 */

// Copy pasta
// {"a":"fetch","queryType":"skv","query":[["a","b"]],"versions":{}}
//
// xxx
// {"a":"streamOps","ref":1,"versions":{},"query":[["a","b"]]}
// {"a":"cancelStream","ref":1}

const prefixFor = { kv: 'KV', sortedkv: 'SVK' }

const serve = (client, source) => {
  let finished = false

  const subForRef = new Map

  client.on('finish', () => {
    finished = true
    subForRef.forEach((ref, sub) => sub.cancel())
    subForRef.clear()
  })
  const write = msg => {
    if (!finished && client.writable) client.write(JSON.stringify(msg)+'\n')
  }

  const protoErr = err => {
    console.log('Invalid client', err)
    //client.close()
  }

  const supportedQueryTypes = ['kv', 'sortedkv'] // TODO: generate from source

  const fetch = (queryType, ...args) => {
    const fetchfn = ({kv: source.fetchKV, sortedkv: source.fetchSVK})[queryType]
    fetchfn(...args)
  }

  const subscribe = (queryType, ...args) => {
    const subfn = ({kv: source.subscribeKV, sortedkv: source.subscribeSKV})[queryType]
    return subfn.apply(source, args)
  }

  // First we send the client a capabilities message.
  write({a:'hello', queryTypes:supportedQueryTypes, opTypes:['json1']}) // TODO.

  client.on('data', (msg) => {
    //console.log('server got', msg)

    switch(msg.a) {
      case 'fetch': {
        const {queryType, ref, query, versions} = msg
        assert(supportedQueryTypes.indexOf(queryType) !== -1) // TODO proper error handling
        fetch(queryType, query, versions, (err, data) => {
          if (err) {
            console.error('Error in fetch', query, versions, err)
            return write({a:'fetch', ref, error: err.message})
          }

          write({a:'fetch', ref, results: Array.from(data.results), versions: data.versions})
        })
        break
      }

      case 'sub': {
        const {queryType, ref, query, versions, opts} = msg
        assert(supportedQueryTypes.indexOf(queryType) !== -1) // TODO proper error handling
        assert(!subForRef.has(ref))

        opts.raw = true // No need to keep a live document set on the subscription on this side.

        const listener = (data, versions) => { write({a:'txn', ref, data: Array.from(data), versions}) }
        const sub = subscribe(queryType, query, versions, opts, listener, (err, cv) => {
          assert(!err) // TODO
          write({a:'sub', ref, version:cv}) // Not sure about the arguments to pass back here.
        })
        subForRef.set(ref, sub)

        break;
      }

      case 'modifySub': {
        const {ref, op, version} = msg
        const sub = subForRef.get(ref)
        if (!sub) {
          return write({a:'modifySub', ref, error:'Ref not found'})
        }

        sub.modify(op, version, (err, newCV) => {
          assert(!err) // TODO
          write({a:'modifySub', ref, version: newCV})
        })
        break
      }

      case 'cancelSub': {
        const {ref} = msg
        const sub = subForRef.get(ref)
        if (!sub) {
          return write({a:'cancelSub', ref, error:'Ref not found'})
        }

        sub.cancel()
        subForRef.delete(ref)
        write({a:'cancelSub', ref, status:'ok'})
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
