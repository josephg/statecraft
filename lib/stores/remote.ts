
import * as I from '../types/interfaces'
import * as N from '../types/netmessages'
import net = require('net')
import msgpack = require('msgpack-lite')
import {Readable, Writable, Duplex} from 'stream'
import assert = require('assert')
import {genCursorAll} from '../util'
import {
  queryTypes, resultTypes,
  snapToJSON, snapFromJSON,
  opToJSON, opFromJSON,
} from '../types/queryops'

const awaitHello = (reader: Readable, callback: I.Callback<N.HelloMsg>) => {
  reader.once('data', (msg: N.HelloMsg) => {
    if (msg.a !== 'hello' || msg.p !== 'statecraft') return callback(Error('Invalid hello message'))
    if (msg.pv !== 0) return callback(Error('Incompatible protocol versions'))
    callback(null, msg)
  })
}

interface RemoteSub extends I.Subscription {
  _nextCallback: I.SubCursorCallback | null,
  _isComplete: boolean,
  _qtype: I.QueryType,
  _listener: I.SubListener,

  [k: string]: any
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

    let nextRef = 1
    type Details = {callback: any, type: I.QueryType | I.ResultType}
    const detailsByRef = new Map<N.Ref, Details>()
    const takeCallback = (ref: N.Ref): Details => {
      const dets = detailsByRef.get(ref)
      detailsByRef.delete(ref)
      assert(dets) // ?? TODO: What should I do in this case?
      return dets!
    }
    const subByRef = new Map<N.Ref, RemoteSub>()

    reader.on('data', (msg: N.SCMsg) => {
      // console.log('got SC data', msg)

      switch (msg.a) {
        case 'fetch': {
          const {ref, results, queryRun, versions} = msg
          const {callback, type: qtype} = takeCallback(ref)
          const type = queryTypes[qtype]!
          callback(null, {
            results: snapFromJSON(type.r, results),
            queryRun: snapFromJSON(type.q, queryRun),
            versions
          })
          break
        }

        case 'mutate': {
          const {ref, v} = msg
          const {callback} = takeCallback(ref)
          callback(null, v)
          break
        }

        case 'err': {
          const {ref, error} = msg
          const {callback} = takeCallback(ref)
          callback(Error(error))
          break
        }

        case 'sub update': {
          const {ref, type: uptype, rv} = msg
          const sub = subByRef.get(ref)!
          assert(sub)
          const type = queryTypes[sub._qtype]

          // :(
          if (uptype === 'aggregate') {
            const {txn, v} = msg as N.SubUpdateAggregate

            sub._listener({
              type: 'aggregate',
              txn: opFromJSON(type.r, txn),
              versions: v,
            }, rv, sub)
          } else {
            const {txns} = msg as N.SubUpdateTxns
            sub._listener({
              type: 'txns',
              txns: txns.map(({v, txn}) => ({versions: v, txn: opFromJSON(type.r, txn)}))
            }, rv, sub)
          }
          break
        }

        case 'sub next': {
          const {ref, q: activeQuery, v: activeVersions, c: isComplete} = msg
          const sub = subByRef.get(ref)!
          assert(sub)
          const cb = sub._nextCallback
          assert(cb)
          sub._nextCallback = null
          sub._isComplete = isComplete

          const type = queryTypes[sub._qtype]

          cb!(null, {
            activeQuery: snapFromJSON(type.q, activeQuery),
            activeVersions
          })
          break
        }
        case 'sub next err': {
          const {ref, error} = msg

          // Yuck.
          const sub = subByRef.get(ref)!
          assert(sub)
          const cb = sub._nextCallback
          assert(cb)
          sub._nextCallback = null

          cb!(Error(error))
          break
        }
        case 'sub update': {
          break
        }

        default: console.error('Invalid or unknown server->client message', msg)
      }
    })

    const store: I.Store = {
      capabilities: {
        queryTypes: new Set(hello.capabilities[0]),
        mutationTypes: new Set(hello.capabilities[1])
      },

      sources: hello.sources,

      fetch(qtype, query, opts, callback) {
        // assert(typeof callback === 'function')
        const ref = nextRef++
        detailsByRef.set(ref, {callback, type:qtype})

        const type = queryTypes[qtype]
        assert(type) // TODO.

        const msg: N.FetchRequest = {
          a: 'fetch', ref, qtype,
          query: snapToJSON(type.q, query),
          opts,
        }
        write(msg)
      },

      mutate(mtype, txn, versions, opts, callback) {
        const type = resultTypes[mtype]
        const ref = nextRef++
        assert(type)
        detailsByRef.set(ref, {callback, type: mtype})

        write({a: 'mutate', ref, mtype, txn: opToJSON(type, txn), v: versions, opts})
      },

      subscribe(qtype, query, opts, listener) {
        const ref = nextRef++

        const sub: RemoteSub = {
          _isComplete: false,
          _nextCallback: null,
          _qtype: qtype,
          _listener: listener,

          cursorNext(opts, callback) {
            // The client should really only have one next call in flight at a time
            assert.strictEqual(this._nextCallback, null)
            this._nextCallback = callback

            write({a: 'sub next', opts, ref})
          },

          cursorAll: null as any,

          isComplete() { return this._isComplete },
          cancel() {
            write({a:'sub cancel', ref})
          }
        }
        sub.cursorAll = genCursorAll(sub)

        subByRef.set(ref, sub)

        const type = queryTypes[qtype]
        assert(type) // TODO.

        write({a: 'sub create', ref, qtype, query: snapToJSON(type.q, query), opts})

        return sub
      },

      getOps(qtype, query, versions, opts, callback) {},

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