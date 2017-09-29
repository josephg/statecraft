// This is a wrapper 'store' around prozess.
//
// The store type is raw. The 'document' is empty, and you can't
// query anything.

import * as I from '../types/interfaces'
import * as err from '../err'
import {connect, KApi, Event, SubCbData} from 'prozess-client'
import assert = require('assert')
import msgpack = require('msgpack-lite')

const codec = msgpack.createCodec({usemap: true})

const doNothing = () => {}

type EventListener = (evts: Event[], resultingVersion: number) => void
type EventOpts = {targetVersion?: number, conflictKeys?: string[]}

type EventProps = {
  evt: NodeBuffer | string,
  opts: EventOpts,
  callback: I.Callback<I.Version>
}

type GetOpsProps = {
  from: number,
  to: number,
  callback: I.Callback<SubCbData>
}

// I'm genuinely not sure the best way to pass back the source. It'd be nice
// to make the entire API syncronous and hold messages or something, but that
// won't work for the source.
const reconnectingProzess = (port: number, hostname: string, firstConnectCallback: I.Callback<I.Source> = doNothing) => {
  let callbackCalled = false
  let wantSubFromV: number | null = null
  let eventListener: EventListener | null = null

  const retryTimeoutSeconds = 2
  let state: 'connecting' | 'waiting' | 'connected' | 'stopped' = 'stopped'
  let client: KApi | null = null
  let timer: NodeJS.Timer | null = null
  let sendEventQueue: EventProps[] = []

  let getOpsQueue: GetOpsProps[] = []

  const sub = () => {
    if (wantSubFromV === null) return

    assert(client)
    client!.onevents = (evts: Event[], resultingVersion: number) => {
      wantSubFromV = resultingVersion
      if (eventListener) eventListener(evts, resultingVersion)
    }
    client!.subscribe({from: wantSubFromV})
  }

  const trySendRaw = (eventProps: EventProps) => {
    if (client != null) client.send(eventProps.evt, eventProps.opts, (err, v) => {
      // We eat ClosedBeforeConfirm errors because we'll just resend the event
      // when we reconnect.
      if (err && err.name === 'ClosedBeforeConfirm') return

      const idx = sendEventQueue.indexOf(eventProps)
      assert(idx >= 0)
      if (idx === 0) sendEventQueue.shift()
      else sendEventQueue.splice(idx, 1)
      eventProps.callback(err, v)
    })
  }

  const trySendGetOps = (props: GetOpsProps) => {
    const {from, to, callback} = props
    if (client != null) client.getOps(from, to, {}, (err, data) => {
      if (err && err.name === 'ClosedBeforeConfirm') return

      // Ugh this is a copy+paste from trySendRaw.
      const idx = getOpsQueue.indexOf(props)
      assert(idx >= 0)
      if (idx === 0) getOpsQueue.shift()
      else getOpsQueue.splice(idx, 1)
      callback(err, data)
    })
  }

  const tryConnect = () => {
    assert.strictEqual(state, 'stopped')
    state = 'connecting'
    connect(port, hostname, (err, _client) => {
      if (state === 'stopped') {
        // This is a bit inelegent. It'd be nicer to call close on the
        // underlying socket.
        if (_client) _client.close()
        return
      } else if (err) {
        console.warn('Connection failed:', err.message)
        state = 'waiting'
        timer = setTimeout(tryConnect, retryTimeoutSeconds * 1000)
        return
      } else {
        assert(client == null)
        state = 'connected'
        client = _client

        // Resubscribe
        sub()

        // Re-send all our pending events.
        // TODO: Resend as a batch, not as individual events.
        sendEventQueue.forEach(trySendRaw)
        getOpsQueue.forEach(trySendGetOps)

        if (!callbackCalled) {
          callbackCalled = true
          firstConnectCallback(null, client!.source)
        }
      }
    })
  }
  tryConnect()

  return {
    wantSubscribe(from: I.Version, listener: EventListener) {
      // You can't bounce around with this because there's race conditions
      // in how I'm updating wantSubFromV in the event listener.
      assert(wantSubFromV === null)

      wantSubFromV = from
      eventListener = listener
      if (client != null) sub()
    },

    // Note this still return ops in the [from, to] range.
    getOps(from: I.Version, to: I.Version, callback: I.Callback<SubCbData>) {
      const oneshot = {from, to, callback}
      getOpsQueue.push(oneshot)
      trySendGetOps(oneshot)
    },

    // Oops - never exposed this from prozess client.
    // wantUnsubscribe() {
    //   if (client != null) client.
    // },
    send(evt: NodeBuffer | string, opts: EventOpts, callback: I.Callback<I.Version> = doNothing) {
      const eventProps = {evt, opts, callback}
      sendEventQueue.push(eventProps)
      trySendRaw(eventProps)
    },
    close() {
      if (client) {
        client.close()
        client = null
      }
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      state = 'stopped'
    },

  }
}

const capabilities = {
  queryTypes: new Set<I.QueryType>(['allkv']),
  mutationTypes: new Set<I.ResultType>(['resultmap']),
}

// TODO: pick a better port.
const prozessStore = (port: number = 9999, hostname: string = 'localhost',
storeCallback: I.Callback<I.SimpleStore>): void => {
  const conn = reconnectingProzess(port, hostname, (error, _source) => {
    if (error) return storeCallback(error)
    const source = _source!

    const store: I.SimpleStore = {
      sources: [source],

      capabilities,

      fetch(qtype, query, opts, callback) {
        return callback(Error('Unsupported query type'))
      },

      mutate(type, txn: I.KVTxn, versions, opts, callback) {
        if (type !== 'resultmap') return callback(new err.UnsupportedTypeError())

        const data = msgpack.encode(txn, {codec})

        const v = versions[source]
        const eventOpts: EventOpts = v == null ? {} : {
          targetVersion: v,
          conflictKeys: Array.from(txn.keys())
        }
        console.log('eventopts', v, eventOpts)

        conn.send(data, eventOpts, (err, version) => {
          if (err) callback(err)
          else callback(null, {[source]: version!})
        })
      },

      getOps(qtype, query, versions, opts, callback) {
        if (qtype !== 'allkv') return callback(new err.UnsupportedTypeError())

        // We need to fetch ops in the range of (from, to].
        const {from, to} = versions[source]

        conn.getOps(from + 1, to, (err, data: SubCbData) => {
          if (err) return callback(err)

          const ops = data!.events
          .map(event => msgpack.decode(event.data))

          callback(null, {ops, versions: {[source]: {from: data!.v_start - 1, to: data!.v_end}}})
        })
      },

      close() {
        conn.close()
      },

    }

    conn.wantSubscribe(-1, (evts, resultingVersion) => {
      if (store.onTxn) {
        evts.forEach(event => {
          // TODO: Pack & unpack batches.
          const txnObj = msgpack.decode(event.data)
          const txn: I.KVTxn = new Map()
          for (const k in txnObj) txn.set(k, txnObj[k])
          store.onTxn!(source, event.version, event.version + 1, 'resultmap', txn)
        })
      }
    })

    storeCallback(null, store)
  })
}

export default prozessStore