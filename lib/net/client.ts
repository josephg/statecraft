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
// import assert from 'assert'

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
    if (msg.a !== N.Action.Hello || msg.p !== 'statecraft') return callback(Error('Invalid hello message'))
    if (msg.pv !== 0) return callback(Error('Incompatible protocol versions'))
    callback(null, msg)
  }
}

interface RemoteSub {
  query: I.Query,
  // This is needed to reestablish the subscription later
  opts: I.SubscribeOpts,

  // The stream that the client is reading over
  stream: Stream<I.CatchupData>,

  // We really need to reuse the stream object between reconnection sessions,
  // but it'd be a huge hack to make the stream done function externally
  // editable. So instead done calls sub.cleanup(), which is (re-)assigned to
  // the current connection.
  cleanup: () => void,
}

type Details = {
  resolve: any,//((_: I.FetchResults | I.GetOpsResult | I.FullVersion) => void),
  reject: ((e: Error) => void),
  type: I.QueryType | I.ResultType
}

// When we reconnect, a ReconnectionData object is passed to the caller. This
// contains everything needed to reestablish the connection. This is an opaque
// structure from the outside. Just pass it back into the next client's
// reconnect opt field.
interface ReconnectionData {
  subs: IterableIterator<RemoteSub>
}

export interface ClientOpts {
  preserveOnClose?: (data: ReconnectionData) => void,
  reconnect?: ReconnectionData,
}

export default function storeFromStreams(
    reader: TinyReader<N.SCMsg>,
    writer: TinyWriter<N.CSMsg>,
    opts: ClientOpts = {}): Promise<I.Store> {
  return new Promise((resolve, reject) => {
    const subByRef = new Map<N.Ref, RemoteSub>()

    reader.onclose = () => {
      if (opts.preserveOnClose) opts.preserveOnClose({
        subs: subByRef.values()
      }); else {
        for (const {stream} of subByRef.values()) {
          // Tell the receiver they won't get any more messages.
          stream.end()
        }
      }

      delete reader.onmessage
    }

    // It'd be nice to rewrite this using promises. The problem is that we
    // have to onmessage() syncronously with the hello message being
    // processed, so awaitHello can't return a promise. It'd be better to have
    // a way to `await stream.read()` method and do it that way.
    awaitHello(reader, (err, _msg?: N.HelloMsg) => {
      if (err) return reject(err)

      // TODO: check reader.isClosed and .. what??

      const hello = _msg!

      let nextRef = 1
      const detailsByRef = new Map<N.Ref, Details>()
      const takeCallback = (ref: N.Ref): Details => {
        const dets = detailsByRef.get(ref)
        detailsByRef.delete(ref)
        assert(dets) // ?? TODO: What should I do in this case?
        return dets!
      }

      reader.onmessage = msg => {
        // console.log('got SC data', msg)

        switch (msg.a) {
          case N.Action.Fetch: {
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

          case N.Action.GetOps: {
            const {ref, ops, v} = <N.GetOpsResponse>msg
            const {resolve, type: qtype} = takeCallback(ref)
            const type = queryTypes[qtype]!
            resolve(<I.GetOpsResult>{
              ops: parseTxnsWithMeta(type.r, ops),
              versions: v,
            })
            break
          }

          case N.Action.Mutate: {
            const {ref, v} = <N.MutateResponse>msg
            const {resolve} = takeCallback(ref)
            resolve(v)
            break
          }

          case N.Action.Err: {
            // This is used for both normal errors and subscription errors.
            // We use the ref to disambiguate.
            const {ref, err} = <N.ResponseErr>msg

            const errObj = errFromJSON(err)
            const sub = subByRef.get(ref)
            if (sub) sub.stream.throw(errObj)
            else takeCallback(ref).reject(errObj)
            break
          }

          case N.Action.SubUpdate: {
            const {ref, q, r, rv, txns, tv} = msg
            const sub = subByRef.get(ref)

            // Will happen if the client closes the sub and the server has
            // messages in flight
            if (!sub) break

            const type = queryTypes[sub.query.type]

            const update: I.CatchupData = {
              replace: r == null ? undefined : {
                q: queryFromNet(q!),
                with: snapFromJSON(type.r, r),
                versions: rv!,
              },

              txns: parseTxnsWithMeta(type.r, txns),

              toVersion: tv,
            }

            // Update fromVersion so if we need to resubscribe we'll request
            // the right version from the server. Note that I'm not updating
            // the version if its specified as 'current'. In that mode you
            // might miss operations! I have no idea if this is the right
            // thing to do.
            const fv = sub.opts.fromVersion
            if (fv == null) sub.opts.fromVersion = update.toVersion
            else if (fv !== 'current') for (const s in tv) fv[s] = tv[s]

            sub.stream.append(update)
            break
          }

          case N.Action.SubClose: {
            const {ref} = msg
            const sub = subByRef.get(ref)
            if (sub != null) {
              sub.stream.end()
              subByRef.delete(ref)
            }
            break
          }

          default: console.error('Invalid or unknown server->client message', msg)
        }
      }

      const registerSub = (sub: RemoteSub) => {
        const ref = nextRef++

        sub.cleanup = () => {
          writer.write({a:N.Action.SubClose, ref})
          subByRef.delete(ref)
        }

        subByRef.set(ref, sub)

        const {opts} = sub
        const netOpts: N.SubscribeOpts = {
          // TODO more here.
          st: Array.from(opts.supportedTypes || supportedTypes),
          fv: opts.fromVersion === 'current' ? 'c' : opts.fromVersion,
        }

        // Advertise that the subscription has been created, but don't wait
        // for acknowledgement before returning it locally.
        writer.write({a: N.Action.SubCreate, ref, query: queryToNet(sub.query), opts: netOpts})
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
              a: N.Action.Fetch, ref,
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
              a: N.Action.Mutate, ref, mtype,
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
              a: N.Action.GetOps, ref,
              query: queryToNet(query),
              v: versions, opts
            })
          })
        },

        subscribe(query, opts = {}) {
          const sub = {
            query, opts,
          } as RemoteSub

          sub.stream = streamToIter<I.CatchupData>(() => sub.cleanup())

          registerSub(sub)
          return sub.stream.iter
        },

        close() {
          // TODO: And terminate all pending callbacks and stuff.
          writer.close()
        }
      }

      if (opts.reconnect) {
        // Wire the listed subscriptions back up to the server
        for (const sub of opts.reconnect.subs) registerSub(sub)
      }

      resolve(store)
    })
  })
}
