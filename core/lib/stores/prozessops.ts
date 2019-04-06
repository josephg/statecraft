// This is a wrapper 'store' around prozess.
//
// The store type is raw. The 'document' is empty, and you can't
// query anything.

import {PClient} from 'prozess-client'
import assert from 'assert'

import * as I from '../interfaces'
import err from '../err'
import {decodeTxn, decodeEvent, sendTxn} from '../prozess'
import {queryTypes} from '../qrtypes'
import {V64, v64ToNum, vEq} from '../version'
import { bitSet } from '../bit'
import SubGroup from '../subgroup'

// const codec = msgpack.createCodec({usemap: true})

// const doNothing = () => {}
const capabilities = {
  // ... Except you can't fetch. :/
  queryTypes: bitSet(I.QueryType.AllKV, I.QueryType.KV, I.QueryType.StaticRange, I.QueryType.Range),
  mutationTypes: bitSet(I.ResultType.KV),
}

// TODO: pick a better port.
const prozessStore = <Val>(conn: PClient): I.Store<Val> => {
  const source = conn.source!

  const getOps: I.GetOpsFn<Val> = async (query, versions, opts) => {
    // We don't need to wait for ready here because the query is passed straight back.
    if (query.type !== I.QueryType.AllKV && query.type !== I.QueryType.KV && query.type !== I.QueryType.StaticRange) throw new err.UnsupportedTypeError()
    const qops = queryTypes[query.type]

    // We need to fetch ops in the range of (from, to].
    const vs = versions[0]
    if (!vs || vEq(vs.from, vs.to)) return {ops: [], versions: vs ? [{from:vs.from, to:vs.to}] : []}

    const {from, to} = vs

    const data = await conn.getEvents(from.length ? v64ToNum(from) + 1 : 0, to.length ? v64ToNum(to) : -1, {})
    // console.log('client.getEvents', from+1, to, data)

    // Filter events by query.
    let ops = data!.events.map(event => decodeEvent(event, source))
    .filter((data) => {
      const txn = qops.adaptTxn(data.txn, query.q)
      if (txn == null) return false
      else {
        data.txn = txn
        return true
      }
    })

    return {
      ops,
      versions: [{from:V64(data!.v_start - 1), to: V64(data!.v_end - 1)}]
    }
  }

  const subGroup = new SubGroup({
    getOps, 
    start(v) {
      let currentVersion = -1
      conn.onevents = (events, nextVersion) => {
        // console.log('conn.onevents', events, nextVersion)
        const txns: I.TxnWithMeta<Val>[] = []
        if (events.length == 0) return

        let fromV: I.Version | null = null
        events.forEach(event => {
          if (currentVersion !== -1) assert.strictEqual(
            currentVersion, event.version - 1,
            'Error: Prozess version consistency violation. This needs debugging'
          )

          if (fromV == null) fromV = V64(event.version - 1)

          // TODO: Pack & unpack batches.
          const [txn, meta] = decodeTxn(event.data)

          const nextVersion = event.version - 1 + event.batch_size

          txns.push({txn, meta, versions: [V64(nextVersion)]})

          // store.onTxn!(source, V64(event.version - 1), V64(nextVersion), 'kv', txn, meta)

          currentVersion = nextVersion
        })

        subGroup.onOp(0, fromV!, txns)
      }

      return new Promise((resolve, reject) => {
        const vs = v == null ? null : v[0]
        // Should this be vs or vs+1 or something?
        conn.subscribe(vs == null ? -1 : v64ToNum(vs) + 1, {}, (err, subdata) => {
          if (err) {
            // I'm not sure what to do here. It'll depend on the error
            console.error('Error subscribing to prozess store')
            return reject(err)
          }
          
          // console.log('prozess ops from', V64(subdata!.v_end + 1), subdata)
          // The events will all be emitted via the onevent callback. We'll do catchup there.
          resolve([V64(subdata!.v_end - 1)]) // +1 ???
        })
      })
    }
  })

  const store: I.Store<Val> = {
    storeInfo: {
      uid: `prozess(${source})`,
      sources: [source],
      capabilities,
    },

    async mutate(type, _txn, versions, opts = {}) {
      if (type !== I.ResultType.KV) throw new err.UnsupportedTypeError()
      const txn = _txn as I.KVTxn<Val>

      const version = await sendTxn(conn, txn, opts.meta || {}, (versions && versions[0]) || new Uint8Array(), {})
      return [version!]
    },

    fetch() {
      throw new err.UnsupportedTypeError()
    },
    getOps,
    subscribe: subGroup.create.bind(subGroup),

    close() {
      conn.close()
    },
  }

  return store
}

export default prozessStore