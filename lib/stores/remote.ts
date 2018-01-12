import * as I from '../types/interfaces'
import * as N from '../types/netmessages'
import net = require('net')
import msgpack = require('msgpack-lite')
import {Readable, Writable, Duplex} from 'stream'
import assert = require('assert')

const awaitHello = (reader: Readable, callback: I.Callback<N.HelloMsg>) => {
  reader.once('data', (msg: N.HelloMsg) => {
    if (msg.a !== 'hello' || msg.p !== 'statecraft') return callback(Error('Invalid hello message'))
    if (msg.pv !== 0) return callback(Error('Incompatible protocol versions'))
    callback(null, msg)
  })
}

const storeFromSocket = (socket: net.Socket, callback: I.Callback<I.Store>) => {
  const writer = msgpack.createEncodeStream()
  writer.pipe(socket)

  const reader = msgpack.createDecodeStream()
  socket.pipe(reader)

  const write = (data: N.CSMsg) => {
    if (writer.writable) {
      writer.write(data)
      ;(writer as any).encoder.flush()
    }
  }

  awaitHello(reader, (err, _msg?: N.HelloMsg) => {
    if (err) return callback(err)
    const hello = _msg!

    console.log('hello', hello)

    let nextRef = 1
    const callbackByRef = new Map<number, any>()
    const takeCallback = (ref: number): any => {
      const cb = callbackByRef.get(ref)
      callbackByRef.delete(ref)
      return cb
    }
    const subByRef = new Map<number, I.Subscription>()

    reader.on('data', (msg: N.SCMsg) => {
      console.log('got SC data', msg)
    })

    const store: I.Store = {
      capabilities: {
        queryTypes: new Set(hello.capabilities[0]),
        mutationTypes: new Set(hello.capabilities[1])
      },

      sources: hello.sources,

      fetch(qtype, query, opts, callback) {
        assert(typeof callback === 'function')
        const ref = nextRef++
        callbackByRef.set(ref, callback)
        const msg: N.FetchRequest = {
          a: 'fetch',
          ref, qtype, query: N.flatten1(query), opts
        }
        write(msg)
      },

      mutate(mtype, txn, versions, opts, callback) {},

      getOps(qtype, query, versions, opts, callback) {},

      subscribe(qtype, query, opts, listener) {
        return {
          cursorNext(opts, callback) {},
          cursorAll(opts?: any, callback?: any) {},
          isComplete() { return true },
          cancel() {}
        }
      },

      close() {
        // TODO: And terminate all pending callbacks and stuff.
        socket.end()
      }
    }

    callback(null, store)
  })



  // return store
}

export default function(port: number, host: string, callback: I.Callback<I.Store>) {
  const socket = net.createConnection(port, host)
  storeFromSocket(socket, callback)
}