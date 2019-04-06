// This is designed to be used from both TCP clients over msgpack (+ framing)
// and via a browser through JSON-over-websockets

import {
  I,
  supportedTypes,
  queryTypes, resultTypes,
  err, errFromJSON, errToJSON,
} from '@statecraft/core'

import * as N from './netmessages'

import {
  queryToNet, queryFromNet,
  fullVersionToNet, fullVersionFromNet,
  fullVersionRangeToNet, fullVersionRangeFromNet,
} from './util'
import {TinyReader, TinyWriter, listen} from './tinystream'
import streamToIter, {Stream} from 'ministreamiterator'
import {Readable, Writable, Duplex} from 'stream'

// import assert from 'assert'

const assert = (a: any) => { if (!a) throw Error('Assertion error: ' + a) }

const parseStoreInfo = (helloMsg: N.HelloMsg): I.StoreInfo => ({
  uid: helloMsg.uid,
  sources: helloMsg.sources,

  capabilities: {
    queryTypes: helloMsg.capabilities[0],
    mutationTypes: helloMsg.capabilities[1]
  },
})

const parseTxnsWithMeta = <Val>(type: I.ResultOps<any, any, I.Txn<Val>>, data: N.NetTxnWithMeta[]): I.TxnWithMeta<Val>[] => (
  data.map(([op, v, meta]) => (<I.TxnWithMeta<Val>>{
    txn: type.opFromJSON(op),
    versions: fullVersionFromNet(v),
    meta
  }))
)

interface RemoteSub<Val> {
  query: I.Query,
  // This is needed to reestablish the subscription later
  opts: I.SubscribeOpts,

  // The stream that the client is reading over
  stream: Stream<I.CatchupData<Val>>,

  // We really need to reuse the stream object between reconnection sessions,
  // but it'd be a huge hack to make the stream done function externally
  // editable. So instead done calls sub.cleanup(), which is (re-)assigned to
  // the current connection.
  cleanup: () => void,
}

type ResRej = (val: any) => void

type Details = {
  resolve: ResRej,
  reject: ResRej,

  type: 'fetch' | 'getOps' | 'mutate',
  args: any[],
  // type: I.QueryType | I.ResultType
}

// When we reconnect, a ReconnectionData object is passed to the caller. This
// contains everything needed to reestablish the connection. This is an opaque
// structure from the outside. Just pass it back into the next client's
// reconnect opt field.
interface ReconnectionData<Val> {
  hello: N.HelloMsg,
  subs: IterableIterator<RemoteSub<Val>>,
  details: IterableIterator<Details>,
}

export interface ClientOpts<Val> {
  // preserveOnClose?: (data: ReconnectionData) => void,
  onClose?: () => void,
  preserveState?: boolean,
  restoreFrom?: NetStore<Val>,
  syncReady?: (store: NetStore<Val>) => void // working around await not returning syncronously.
}

export type NetStore<Val> = I.Store<Val> & {
  getState(): ReconnectionData<Val>
}

const checkHello = (hello: N.HelloMsg, ref?: I.StoreInfo) => {
  // TODO: Move these errors into standard errors. Especially important for
  // protocol version (& probably want some sort of epoch version too!)
  if (hello.a !== N.Action.Hello || hello.p !== 'statecraft') throw Error('Invalid hello message')
  if (hello.pv !== 0) throw Error('Incompatible protocol versions')

  if (ref && ref.uid !== hello.uid) {
    // TODO: Check that the storeinfo is compatible.
    console.warn('Warning: Store has changed.')
    throw new err.StoreChangedError()
  }
}

function storeFromStreams<Val>(reader: TinyReader<N.SCMsg>,
    writer: TinyWriter<N.CSMsg>,
    hello: N.HelloMsg, opts: ClientOpts<Val> = {}): NetStore<Val> {
  let nextRef = 1
  const subByRef = new Map<N.Ref, RemoteSub<Val>>()
  const detailsByRef = new Map<N.Ref, Details>()
  let closed = false

  const takeCallback = (ref: N.Ref): Details => {
    const dets = detailsByRef.get(ref)
    detailsByRef.delete(ref)
    assert(dets) // ?? TODO: What should I do in this case?
    return dets!
  }

  const cleanup = () => {
    for (const {stream} of subByRef.values()) {
      // Tell the receiver they won't get any more messages.
      stream.end()
    }
    subByRef.clear()

    for (const {reject} of detailsByRef.values()) {
      reject(Error('Store closed before results returned'))
    }

    detailsByRef.clear()
  }

  reader.onClose = () => {
    if (opts.onClose) opts.onClose()
    if (!opts.preserveState) cleanup()

    delete reader.onMessage
  }

  listen(reader, msg => {
    // This is needed because we call detailsByRef.clear() in cleanup.
    if (closed) return

    // console.log('S->C data', msg)

    switch (msg.a) {
      case N.Action.Fetch: {
        const {ref, results, bakedQuery, versions} = <N.FetchResponse>msg
        const {resolve, args: [q]} = takeCallback(ref)
        const type = queryTypes[q.type]!
        resolve(<I.FetchResults<Val>>{
          results: type.resultType.snapFromJSON(results),
          bakedQuery: bakedQuery ? queryFromNet(bakedQuery) : undefined,
          versions: fullVersionRangeFromNet(versions)
        })
        break
      }

      case N.Action.GetOps: {
        const {ref, ops, v} = <N.GetOpsResponse>msg
        const {resolve, args: [q]} = takeCallback(ref)
        const type = queryTypes[q.type]!
        resolve(<I.GetOpsResult<Val>>{
          ops: parseTxnsWithMeta(type.resultType, ops),
          versions: fullVersionRangeFromNet(v),
        })
        break
      }

      case N.Action.Mutate: {
        const {ref, v} = <N.MutateResponse>msg
        const {resolve} = takeCallback(ref)
        resolve(<I.FullVersion>fullVersionFromNet(v))
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
        const {ref, q, r, rv, txns, tv, u} = msg
        const sub = subByRef.get(ref)

        // Will happen if the client closes the sub and the server has
        // messages in flight
        if (!sub) break

        const type = queryTypes[sub.query.type]

        const toVersion = fullVersionFromNet(tv)

        const update: I.CatchupData<Val> = {
          replace: r == null ? undefined : {
            q: queryFromNet(q!) as I.ReplaceQuery,
            with: type.resultType.snapFromJSON(r),
            versions: fullVersionFromNet(rv!),
          },

          txns: parseTxnsWithMeta(type.resultType, txns),

          toVersion,
          caughtUp: u,
        }

        // Update fromVersion so if we need to resubscribe we'll request
        // the right version from the server. Note that I'm not updating
        // the version if its specified as 'current'. In that mode you
        // might miss operations! I have no idea if this is the right
        // thing to do.
        const fv = sub.opts.fromVersion
        if (fv == null) sub.opts.fromVersion = toVersion
        else if (fv !== 'current') toVersion.forEach((v, si) => {
          if (v != null) fv[si] = v
        })

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
  })

  const registerSub = (sub: RemoteSub<Val>) => {
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
      fv: opts.fromVersion === 'current' ? 'c'
        : opts.fromVersion == null ? undefined
        : fullVersionToNet(opts.fromVersion),
    }

    // Advertise that the subscription has been created, but don't wait
    // for acknowledgement before returning it locally.
    writer.write({a: N.Action.SubCreate, ref, query: queryToNet(sub.query), opts: netOpts})
  }

  const reqToMessage: {
    [k: string]: (ref: number, ...args: any) => N.CSMsg
  } = {
    fetch: (ref: number, query: I.Query, opts: I.FetchOpts = {}) => ({
      a: N.Action.Fetch, ref,
      query: queryToNet(query),
      opts: opts,
    }),

    getOps: (ref: number, query: I.Query, versions: I.FullVersionRange, opts: I.GetOpsOptions = {}) => ({
      a: N.Action.GetOps, ref,
      query: queryToNet(query),
      v: fullVersionRangeToNet(versions), opts
    }),

    mutate: (ref: number, mtype: I.ResultType, txn: I.Txn<Val>, versions: I.FullVersion = [], opts: I.MutateOptions = {}) => ({
      a: N.Action.Mutate, ref, mtype,
      txn: resultTypes[mtype].opToJSON(txn),
      v: fullVersionToNet(versions), opts
    })
  }

  const registerReq = (type: 'fetch' | 'getOps' | 'mutate', resolve: ResRej, reject: ResRej, args: any[]) => {
    const ref = nextRef++
    const msg = reqToMessage[type](ref, ...args)
    detailsByRef.set(ref, {type, args, resolve, reject})
    writer.write(msg)
  }

  const req = (type: 'fetch' | 'getOps' | 'mutate') => (...args: any[]): Promise<any> => {
    return new Promise((resolve, reject) => {
      if (closed) return reject(Error('Cannot make request from a closed store'))
      registerReq(type, resolve, reject, args)
    })
  }

  if (opts.restoreFrom) {
    const state = opts.restoreFrom.getState()
    // Wire the listed subscriptions back up to the server
    for (const sub of state.subs) registerSub(sub)
    for (const d of state.details) registerReq(d.type, d.resolve, d.reject, d.args)
  }

  // const store: I.Store = {
  return {
    storeInfo: parseStoreInfo(hello),

    fetch: req('fetch'),
    getOps: req('getOps'),
    mutate: req('mutate'),

    subscribe(query, opts = {}) {
      if (closed) throw Error('Cannot make request from a closed store')

      const sub = {
        query, opts,
      } as RemoteSub<Val>

      sub.stream = streamToIter<I.CatchupData<Val>>(() => sub.cleanup())

      registerSub(sub)
      return sub.stream.iter
    },

    close() {
      closed = true
      writer.close()
      cleanup()
    },

    getState() {
     return {
        hello,
        subs: subByRef.values(),
        details: detailsByRef.values(),
      };
    }
  }
}


// export function reconnectStore(reader: TinyReader<N.SCMsg>,
//     writer: TinyWriter<N.CSMsg>,
//     reconnectState: ReconnectionData,
//     opts: ClientOpts = {}): NetStore {

//   opts.reconnect = reconnectState // Gross.
//   return storeFromStreams(reader, writer, reconnectState.hello, opts)
// }


const readNext = <T>(r: TinyReader<T>): Promise<T> => (
  // This is a bit overly simple for general use, but it should work ok for what I'm using it for.
  new Promise((resolve, reject) => {
    if (r.buf.length) return resolve(r.buf.shift())
    else {
      r.onMessage = msg => {
        resolve(msg)
        delete r.onMessage // Let subsequent messages flow to r.buf
      }
      r.onClose = () => reject(new Error('Closed before handshake'))
    }
  })
)

export default async function createStore<Val>(
    reader: TinyReader<N.SCMsg>,
    writer: TinyWriter<N.CSMsg>,
    opts: ClientOpts<Val> = {}): Promise<NetStore<Val>> {

  const hello = await readNext(reader) as N.HelloMsg
  checkHello(hello, opts.restoreFrom ? opts.restoreFrom.storeInfo : undefined)

  const store = storeFromStreams(reader, writer, hello, opts)
  if (opts.syncReady) opts.syncReady(store)
  return store
}
