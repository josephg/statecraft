// This is designed to be used from both TCP clients over msgpack (+ framing)
// and via a browser through JSON-over-websockets

import * as I from '../types/interfaces'
import * as N from './netmessages'
import {errToJSON, errFromJSON} from '../err'

import {queryToNet, queryFromNet} from './util'
import {
  queryTypes, resultTypes,
  snapToJSON, snapFromJSON,
  opToJSON, opFromJSON,
  wrapQuery
} from '../types/queryops'
import streamToIter from '../streamToIter'
import {Readable, Writable, Duplex} from 'stream'
// import assert = require('assert')

const assert = (a: any) => { if (!a) throw Error('Assertion error: ' + a) }

// Not using proper streams because they add about 150k of crap to the browser
// bundle

export interface TinyReader {
  onmessage?: (msg: N.SCMsg) => void
}

export interface TinyWriter {
  write(data: N.CSMsg): void,
  close(): void,
}

const parseStoreInfo = (helloMsg: N.HelloMsg): I.StoreInfo => ({
  sources: helloMsg.sources,

  capabilities: {
    queryTypes: new Set(helloMsg.capabilities[0]),
    mutationTypes: new Set(helloMsg.capabilities[1])
  },
})

type Callback<T> = (err: Error | null, results?: T) => void
const awaitHello = (reader: TinyReader, callback: Callback<N.HelloMsg>) => {
  reader.onmessage = (msg: N.SCMsg) => {
    if (msg.a !== 'hello' || msg.p !== 'statecraft') return callback(Error('Invalid hello message'))
    if (msg.pv !== 0) return callback(Error('Incompatible protocol versions'))
    callback(null, msg)
  }
}

interface RemoteSub extends I.Subscription {
  _nextPromise: [any, any] | null,
  _isComplete: boolean,
  _qtype: I.QueryType,

  _append: (data: I.CatchupData) => void,
  // [k: string]: any
}

export default function storeFromStreams(reader: TinyReader, writer: TinyWriter): Promise<I.Store> {
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
      const takeSubPromise = (sub: RemoteSub): [any, any] => {
        assert(sub)
        assert(sub._nextPromise)
        const resolvereject = sub._nextPromise!
        sub._nextPromise = null
        return resolvereject
      }

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
            const {ref, rv, q, r, txns} = msg
            const sub = subByRef.get(ref)!
            assert(sub)
            const type = queryTypes[sub._qtype]

            const update: I.CatchupData = {
              resultingVersions: rv,

              replace: r == null ? undefined : {
                q: queryFromNet(q!),
                with: snapFromJSON(type.r, r)
              },

              txns: txns.map(({v, txn, meta}) => ({versions: v, txn: opFromJSON(type.r, txn), meta}))
            }

            sub._append(update)
            break
          }

          case 'sub next': {
            const {ref, q: activeQuery, v: activeVersions, c: isComplete} = msg
            const sub = subByRef.get(ref)!
            const [resolve] = takeSubPromise(sub)
            sub._isComplete = isComplete

            const type = queryTypes[sub._qtype]

            resolve({
              activeQuery: queryFromNet(activeQuery),
              activeVersions
            })
            break
          }
          case 'sub next err': {
            const {ref, err} = msg

            const sub = subByRef.get(ref)!
            const [_, reject] = takeSubPromise(sub)
            reject(errFromJSON(err))
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
            writer.write({a:'sub cancel', ref})
          })

          const sub: RemoteSub = {
            _isComplete: false,
            _nextPromise: null,
            _qtype: query.type,
            _append: stream.append,
            iter: stream.iter,
            [Symbol.asyncIterator]: () => stream.iter,

            cursorNext(opts) {
              // The client should really only have one next call in flight at a time
              if (this._nextPromise !== null) throw Error('Invalid internal state')

              return new Promise((resolve, reject) => {
                this._nextPromise = [resolve, reject]

                writer.write({a: 'sub next', opts, ref})
              })
            },

            async cursorAll(opts) {
              while (true) {
                const result = await this.cursorNext(opts)
                if (this.isComplete()) return result
              }
            },

            isComplete() { return this._isComplete },
          }

          subByRef.set(ref, sub)

          // const type = queryTypes[qtype]
          // assert(type) // TODO.

          const netOpts: N.SubscribeOpts = {
            kd: typeof opts.knownDocs === 'object' ? Array.from(opts.knownDocs)
              : opts.knownDocs,
            kv: opts.knownAtVersions,
          }
          writer.write({a: 'sub create', ref, query: queryToNet(query), opts: netOpts})

          return sub
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
