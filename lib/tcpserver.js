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

const capabilitiesAsJSON = capabilities => {
  const out = {}
  for (let k in capabilities) out[k] = Array.from(capabilities[k])
  return out
}

const serve = (client, source) => {
  let finished = false

  const subForRef = new Map

  client.on('finish', () => {
    finished = true
    subForRef.forEach((ref, sub) => sub.cancel())
    subForRef.clear()
  })
  const write = msg => {
    assert(typeof msg === 'object')
    //console.log('server write', msg)
    if (!finished && client.writable) client.write(JSON.stringify(msg)+'\n')
  }

  const protoErr = err => {
    console.log('Invalid client', err)
    //client.close()
  }

  // First we send the client a capabilities message.
  write({
    a:'hello', // Hello? Maybe ... init?
    pv: 1,
    capabilities: capabilitiesAsJSON(source.capabilities),
  })

  // Items are in the set if the client thinks they are complete.
  const expectComplete = new WeakSet

  const withIsComplete = (msg, sub) => {
    const isComplete = sub.isComplete()
    if (isComplete !== expectComplete.has(sub)) {
      msg.isComplete = isComplete
      if (isComplete) expectComplete.add(sub)
      else expectComplete.delete(sub)
    }
    return msg
  }

  client.on('data', (msg) => {
    //console.log('server got', msg)

    switch(msg.a) {
      // ****** Fetch *******
      case 'fetch': {
        const {ref, qtype, query, opts} = msg
        assert(source.capabilities.queryTypes.has(qtype)) // TODO proper error handling

        // TODO: Does it make sense to pass the options straight through?
        source.fetch(qtype, query, opts || {}, (err, data) => {
          if (err) {
            console.error('Error in fetch', query, err)
            return write({a:'fetch', ref, error: err.message})
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

      // ****** Get Ops *******
      case 'getops': {
        const {ref, qtype, query, versions, opts} = msg
        assert(source.capabilities.queryTypes.has(qtype)) // TODO proper error handling

        source.getOps(qtype, query, versions, opts, (err, ops) => {
          if (err) {
            console.error('Error in getOps', query, versions, err)
            return write({a:'getops', ref, error: err.message})
          }

          // Flatten the transactions in the ops.
          ops.forEach(op => op.txn = Array.from(op.txn))
          write({a:'getops', ref, ops})
        })

        break
      }

      // ****** Subscribe *******
      case 'sub': {
        const {ref, qtype, query, versions, opts} = msg
        assert(source.capabilities.queryTypes.has(qtype)) // TODO proper error handling
        assert(!subForRef.has(ref))

        opts.raw = true // No need to keep a live document set on the server side.

        let sub

        const listener = (type, update, newVersions) => {
          write(withIsComplete({a:'sub txn', ref, type, update: Array.from(update), newVersions}, sub))
        }

        sub = source.subscribe(qtype, query, versions, opts, listener)
        subForRef.set(ref, sub)
        break;
      }

      case 'sub next': {
        const {ref, opts} = msg
        const sub = subForRef.get(ref)
        if (!sub) return write({a:'sub error', ref, error:'In modify ref not found'})
        sub.cursorNext(opts, err => {
          // TODO: Propogate cursor next errors back to the client.
          write(withIsComplete({a:'sub next', ref}, sub))
        })
        break
      }

      case 'sub modify': {
        const {ref, qop, qversion} = msg
        const sub = subForRef.get(ref)
        if (!sub) return write({a:'sub error', ref, error:'In modify ref not found'})
        sub.modify(qop, qversion)
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

