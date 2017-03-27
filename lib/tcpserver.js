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
    //console.log('server write', msg)
    if (!finished && client.writable) client.write(JSON.stringify(msg)+'\n')
  }

  const protoErr = error => {
    console.log('Invalid client', error)
    //client.close()
  }

  const fetch = (queryType, ...args) => {
    const fetchfn = ({kv: source.fetchKV, sortedkv: source.fetchSKV})[queryType]
    fetchfn.apply(source, args)
  }

  const subscribe = (queryType, ...args) => {
    const subfn = ({kv: source.subscribeKV, sortedkv: source.subscribeSKV})[queryType]
    return subfn.apply(source, args)
  }

  // First we send the client a capabilities message.
  write({
    a:'hello', // Hello? Maybe ... init?
    pv: 1,
    queryTypes: Object.keys(source.supportedQueryTypes),
    opTypes: ['json1']
  })

  client.on('data', (msg) => {
    //console.log('server got', msg)

    switch(msg.a) {
      // ****** Fetch *******
      case 'fetch': {
        const {queryType, ref, query, versions, opts} = msg
        assert(source.supportedQueryTypes[queryType]) // TODO proper error handling

        // TODO: Does it make sense to pass the options straight through?
        fetch(queryType, query, versions, opts || {}, (error, data) => {
          if (error) {
            console.error('Error in fetch', query, versions, error)
            return write({a:'fetch', ref, error: error.message})
          }

          write({a:'fetch', ref, results: Array.from(data.results), versions: data.versions})
        })
        break
      }

      // ****** Subscribe *******
      case 'sub': {
        const {queryType, ref, query, versions, opts} = msg
        assert(source.supportedQueryTypes[queryType]) // TODO proper error handling
        assert(!subForRef.has(ref))

        opts.raw = true // No need to keep a live document set on the subscription on this side.

        const listener = (data, versions) => {
          //console.log('sending txn', versions)
          write({a:'txn', ref, data: Array.from(data), versions})
        }
        const sub = subscribe(queryType, query, versions, opts, listener, (error, cv) => {
          //console.log('4s', sub.versions)
          assert(!error) // TODO
          write({a:'sub', ref, cv, versions:sub.versions}) // Not sure about the arguments to pass back here.
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

        sub.modify(op, version, (error, newCV) => {
          assert(!error) // TODO
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

      // ****** Mutate *******
      case 'mutate': {
        const {ref, txn, versions, opts} = msg
        const txnMap = new Map(txn)

        source.mutate(txnMap, versions, opts, (error, resultvs) => {
          if (error) write({a:'mutate', ref, error:error.message})
          else write({a:'mutate', ref, versions:resultvs})
        })
        break
      }



      default:
        console.error('Invalid msg.a', msg.a)
        protoErr('Invalid request')
    }
  })
}

// TODO: Figure out a way to export this without it being require('tcpserver').tcpServer
exports.tcpServer = function(source) {
  const net = require('net')
  const es = require('event-stream')

  return net.createServer(c => {
    serve(es.duplex(c, c.pipe(es.split()).pipe(es.parse())), source)
  })
}

