// This is designed to be used from both TCP clients over msgpack (+ framing)
// and via a browser through JSON-over-websockets

import * as I from '../types/interfaces'
import * as T from '../types/type'
import * as N from './netmessages'
import {errToJSON, errFromJSON} from '../err'

import {queryToNet, queryFromNet} from './util'
import {
  queryTypes, resultTypes,
  snapToJSON, snapFromJSON,
  opToJSON, opFromJSON,
  wrapQuery
} from '../types/queryops'
import {TinyReader, TinyWriter} from './tinystream'
import streamToIter, {Stream} from '../streamToIter'
import {Readable, Writable, Duplex} from 'stream'
import {supportedTypes} from '../types/registry'
// import assert = require('assert')

const assert = (a: any) => { if (!a) throw Error('Assertion error: ' + a) }

const parseStoreInfo = (helloMsg: N.HelloMsg): I.StoreInfo => ({
  sources: helloMsg.sources,

  capabilities: {
    queryTypes: new Set(helloMsg.capabilities[0]),
    mutationTypes: new Set(helloMsg.capabilities[1])
  },
})

const parseTxnsWithMeta = (type: T.Type<any, I.Txn>, data: N.NetTxnWithMeta[]): I.TxnWithMeta[] => (
  data.map(([op, v, meta]) => (<I.TxnWithMeta>{
    txn: opFromJSON(type, op),
    versions: v,
    meta
  }))
)

type Callback<T> = (err: Error | null, results?: T) => void
const awaitHello = (reader: TinyReader<N.SCMsg>, callback: Callback<N.HelloMsg>) => {
  reader.onmessage = (msg: N.SCMsg) => {
    if (msg.a !== 'hello' || msg.p !== 'statecraft') return callback(Error('Invalid hello message'))
    if (msg.pv !== 0) return callback(Error('Incompatible protocol versions'))
    callback(null, msg)
  }
}

interface RemoteSub {
  qtype: I.QueryType,
  stream: Stream<I.CatchupData>,
}

export default function storeFromStreams(reader: TinyReader<N.SCMsg>, writer: TinyWriter<N.CSMsg>): Promise<I.Store> {
  return new Promise((resolve, reject) => {
    // It'd be nice to rewrite this using promises. The problem is that we
    // have to onmessage() syncronously with the hello message being
    // processed, so awaitHello can't return a promise. It'd be better to have
    // a way to `await stream.read()` method and do it that way.
    awaitHello(reader, (err, _msg?: N.HelloMsg) => {
      if (err) return reject(err)
      const hello = _msg!

      let nextRef = 1
      type Details = {
        resolve: any,//((_: I.FetchResults | I.GetOpsResult | I.FullVersion) => void),
        reject: ((e: Error) => void),
        type: I.QueryType | I.ResultType
      }
      const detailsByRef = new Map<N.Ref, Details>()
      const takeCallback = (ref: N.Ref): Details => {
        const dets = detailsByRef.get(ref)
        detailsByRef.delete(ref)
        assert(dets) // ?? TODO: What should I do in this case?
        return dets!
      }
      const subByRef = new Map<N.Ref, RemoteSub>()

      reader.onmessage = msg => {
        // console.log('got SC data', msg)

        switch (msg.a) {
          case 'fetch': {
            const {ref, results, queryRun, versions} = <N.FetchResponse>msg
            const {resolve, type: qtype} = takeCallback(ref)
            const type = queryTypes[qtype]!
            resolve(<I.FetchResults>{
              results: snapFromJSON(type.r, results),
              queryRun: queryFromNet(queryRun),
              versions
            })
            break
          }

          case 'getops': {
            const {ref, ops, v} = <N.GetOpsResponse>msg
            const {resolve, type: qtype} = takeCallback(ref)
            const type = queryTypes[qtype]!
            resolve(<I.GetOpsResult>{
              ops: parseTxnsWithMeta(type.r, ops),
              versions: v,
            })
            break
          }

          case 'mutate': {
            const {ref, v} = <N.MutateResponse>msg
            const {resolve} = takeCallback(ref)
            resolve(v)
            break
          }

          case 'err': {
            const {ref, err} = <N.ResponseErr>msg
            const {reject} = takeCallback(ref)
            reject(errFromJSON(err))
            break
          }

          case 'sub update': {
            const {ref, q, r, rv, txns, tv} = msg
            const sub = subByRef.get(ref)!
            assert(sub)
            const type = queryTypes[sub.qtype]

            const update: I.CatchupData = {
              replace: r == null ? undefined : {
                q: queryFromNet(q!),
                with: snapFromJSON(type.r, r),
                versions: rv!,
              },

              txns: parseTxnsWithMeta(type.r, txns),

              toVersion: tv,
            }

            sub.stream.append(update)
            break
          }

          case 'sub update err': {
            const {ref, err} = msg

            const sub = subByRef.get(ref)!
            sub.stream.throw(errFromJSON(err))
            break
          }

          case 'sub ret': {
            const {ref} = msg
            const sub = subByRef.get(ref)!
            sub.stream.end()
            subByRef.delete(ref)
            break
          }

          default: console.error('Invalid or unknown server->client message', msg)
        }
      }

      const store: I.Store = {
        storeInfo: parseStoreInfo(hello),

        fetch(query, opts = {}) {
          return new Promise((resolve, reject) => {
            // const qtype = query.type
            // assert(typeof callback === 'function')
            const ref = nextRef++
            detailsByRef.set(ref, {resolve, reject, type:query.type})

            // const type = queryTypes[qtype]
            // assert(type) // TODO.

            writer.write({
              a: 'fetch', ref,
              query: queryToNet(query),
              opts: opts,
            })
          })
        },

        mutate(mtype, txn, versions = {}, opts = {}) {
          return new Promise((resolve, reject) => {
            // console.log('....')
            // setTimeout(() => {
            const ref = nextRef++

            const type = resultTypes[mtype]
            assert(type) // TODO: proper checking.

            detailsByRef.set(ref, {resolve, reject, type: mtype})

            writer.write({
              a: 'mutate', ref, mtype,
              txn: opToJSON(type, txn),
              v: versions, opts
            })
            // }, 5000)
          })
        },

        getOps(query, versions, opts = {}) {
          return new Promise((resolve, reject) => {
            const ref = nextRef++
            // const qtype = query.type
            detailsByRef.set(ref, {resolve, reject, type:query.type})

            // const type = queryTypes[qtype]
            // assert(type) // TODO.

            writer.write({
              a: 'getops', ref,
              query: queryToNet(query),
              v: versions, opts
            })
          })
        },

        subscribe(query, opts = {}) {
          const ref = nextRef++
          const stream = streamToIter<I.CatchupData>(() => {
            writer.write({a:'sub close', ref})
          })

          const sub: RemoteSub = {
            qtype: query.type,
            stream,
          }

          subByRef.set(ref, sub)

          // const type = queryTypes[qtype]
          // assert(type) // TODO.

          const netOpts: N.SubscribeOpts = {
            // TODO more here.
            st: Array.from(opts.supportedTypes || supportedTypes),
            fv: opts.fromVersion === 'current' ? 'c' : opts.fromVersion,
          }

          // Advertise that the subscription has been created, but don't wait
          // for acknowledgement before returning it locally.
          writer.write({a: 'sub create', ref, query: queryToNet(query), opts: netOpts})

          return stream.iter
        },

        close() {
          // TODO: And terminate all pending callbacks and stuff.
          writer.close()
        }
      }

      resolve(store)
    })
  })
}
