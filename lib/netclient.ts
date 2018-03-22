// This is designed to be used from both TCP clients over msgpack (+ framing)
// and via a browser through JSON-over-websockets

import * as I from './types/interfaces'
import * as N from './types/netmessages'
import {genCursorAll} from './util'
import {errToJSON, errFromJSON} from './err'

import {
  queryTypes, resultTypes,
  snapToJSON, snapFromJSON,
  opToJSON, opFromJSON,
} from './types/queryops'

import {Readable, Writable, Duplex} from 'stream'
import assert = require('assert')


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

  // [k: string]: any
}

export default function storeFromStreams(reader: Readable, writer: Writable, callback: I.Callback<I.Store>) {
  const write = (data: N.CSMsg) => {
    if (writer.writable) {
      writer.write(data)

      // This is a huge hack to work around a bug in msgpack
      // https://github.com/kawanet/msgpack-lite/issues/80
      if ((writer as any).encoder) (writer as any).encoder.flush()
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
          const {ref, results, queryRun, versions} = <N.FetchResponse>msg
          const {callback, type: qtype} = takeCallback(ref)
          const type = queryTypes[qtype]!
          callback(null, <I.FetchResults>{
            results: snapFromJSON(type.r, results),
            queryRun: snapFromJSON(type.q, queryRun),
            versions
          })
          break
        }

        case 'getops': {
          const {ref, ops, v} = <N.GetOpsResponse>msg
          const {callback, type: qtype} = takeCallback(ref)
          const type = queryTypes[qtype]!
          callback(null, <I.GetOpsResult>{
            ops: ops.map(([op, v]) => (<I.TxnWithMeta>{
              txn: opFromJSON(type.r, op),
              versions: v,
            })),
            versions: v,
          })
          break
        }

        case 'mutate': {
          const {ref, v} = <N.MutateResponse>msg
          const {callback} = takeCallback(ref)
          callback(null, v)
          break
        }

        case 'err': {
          const {ref, err} = <N.ResponseErr>msg
          const {callback} = takeCallback(ref)
          callback(errFromJSON(err))
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
          const {ref, err} = msg

          // Yuck.
          const sub = subByRef.get(ref)!
          assert(sub)
          const cb = sub._nextCallback
          assert(cb)
          sub._nextCallback = null

          cb!(errFromJSON(err))
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

        write({
          a: 'fetch', ref, qtype,
          query: snapToJSON(type.q, query),
          opts,
        })
      },

      mutate(mtype, txn, versions, opts, callback) {
        const ref = nextRef++

        const type = resultTypes[mtype]
        assert(type) // TODO: proper checking.

        detailsByRef.set(ref, {callback, type: mtype})

        write({a: 'mutate', ref, mtype,
          txn: opToJSON(type, txn),
          v: versions, opts
        })
      },

      getOps(qtype, query, versions, opts, callback) {
        const ref = nextRef++
        detailsByRef.set(ref, {callback, type:qtype})

        const type = queryTypes[qtype]
        assert(type) // TODO.

        write({
          a: 'getops', ref, qtype,
          query: snapToJSON(type.q, query),
          v: versions, opts
        })
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

      close() {
        // TODO: And terminate all pending callbacks and stuff.
        writer.end()
      }
    }

    callback(null, store)
  })
}
