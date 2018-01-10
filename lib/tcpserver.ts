import * as I from './types/interfaces'
import * as N from './types/netmessages'
import net = require('net')
import msgpack = require('msgpack-lite')
import {Readable, Writable, Transform} from 'stream'
import assert = require('assert')

const capabilitiesToJSON = (c: I.Capabilities): any[] => {
  return [
    Array.from(c.queryTypes),
    Array.from(c.mutationTypes)
  ]
}

const serve = (reader: Readable, writer: Writable, store: I.Store) => {
  const subForRef = new Map<N.Ref, I.Subscription>()
  // let finished = false

  const protoErr = (err: Error) => {
    console.error('Invalid client', err)
  }

  // Work around this bug:
  // https://github.com/kawanet/msgpack-lite/issues/80
  const write = (data: N.SCMsg) => {
    writer.write(data)
    ;(writer as any).encoder.flush()
  }

  // First we send the capabilities
  write({
    a: 'hello',
    p: 'statecraft',
    pv: 0,
    sources: store.sources,
    capabilities: capabilitiesToJSON(store.capabilities),
  })

  reader.on('data', (msg: N.CSMsg) => {
    switch (msg.a) {
      case 'fetch': {
        const {ref, qtype, query, opts} = (msg as N.FetchRequest)
        assert(store.capabilities.queryTypes.has(qtype)) // TODO: better error handling

        store.fetch(qtype, query, opts, (err, data) => {
          if (err) {
            console.warn('Error in fetch', err)
            write({a: 'fetch', ref, error: err.message})
          } else {
            write({
              a: 'fetch',
              ref,
              results: N.flatten1(data!.results),
              queryRun: data!.queryRun,
              versions: data!.versions
            })
          }
        })
        break
      }

      default:
        protoErr(new Error('Invalid msg.a: ' + msg.a))
    }
  })
}

export default (store: I.Store) => {
  console.log('made store')
  return net.createServer(c => {
    // console.log('got connection')
    const writer = msgpack.createEncodeStream()
    writer.pipe(c)

    const reader = msgpack.createDecodeStream()
    c.pipe(reader)

    serve(reader, writer, store)
  })
}