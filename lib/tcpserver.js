const assert = require('assert')
const {Writable} = require('stream')
const {normalizeRanges} = require('./util')

/* Protocol
 *
 * Fetch:
 * C: {a:'fetch', qtype:'kv', ref:_, query:_, versions:_}
 * S: {a:'fetch', qtype:'kv', ref:_, results:_, versions:_}
 * or
 * S: {a:'fetch', ref:_, error:_}
 *
 *
 */

// Copy pasta
// {"a":"fetch","qtype":"skv","query":[["a","b"]],"versions":{}}
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
        const {qtype, ref, query, versions, opts} = msg
        assert(source.supportedQueryTypes[qtype]) // TODO proper error handling

        // TODO: Does it make sense to pass the options straight through?
        source.fetch(qtype, query, versions, opts || {}, (error, data) => {
          if (error) {
            console.error('Error in fetch', query, versions, error)
            return write({a:'fetch', ref, error: error.message})
          }

          write({
            a:'fetch', ref,
            results: Array.from(data.results), // TODO: Object.assign into the message?
            versions: data.versions,
            queryRun: data.queryRun
          })
        })
        break
      }

      // ****** Subscribe *******
      case 'sub': {
        const {qtype, ref, query, versions, opts} = msg
        assert(source.supportedQueryTypes[qtype]) // TODO proper error handling
        assert(!subForRef.has(ref))

        opts.raw = true // No need to keep a live document set on the server side.

        let sub

        let expectComplete = false

        const listener = (type, update, newVersions) => {
          const isComplete = sub.isComplete() // TODO: Specialcasing this is gross.
          const msg = {a:'sub txn', ref, type, update: Array.from(update), newVersions}
          if (isComplete !== expectComplete) {
            msg.isComplete = expectComplete = isComplete
          }
          write(msg)
        }

        sub = source.subscribe(qtype, query, versions, opts, listener)
        subForRef.set(ref, sub)
        break;
      }

      case 'sub next': {
        const {ref, opts} = msg
        const sub = subForRef.get(ref)
        if (!sub) return write({a:'sub error', ref, error:'In modify ref not found'})
        sub.cursorNext(opts) // TODO: Propogate cursor next errors back to the client.
        break
      }

      case 'sub modify': {
        const {ref, qop} = msg
        const sub = subForRef.get(ref)
        if (!sub) return write({a:'sub error', ref, error:'In modify ref not found'})
        sub.modify(qop)
        break
      }

      case 'sub cancel': {
        const {ref} = msg
        const sub = subForRef.get(ref)
        if (!sub) return write({a:'sub error', ref, error:'In cancel ref not found'})

        sub.cancel()
        subForRef.delete(ref)
        //write({a:'sub cancel', ref, status:'ok'})
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

