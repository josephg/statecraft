import * as I from './types/interfaces'
import * as N from './types/netmessages'
import {
  queryTypes, resultTypes,
  snapToJSON, snapFromJSON,
  opToJSON, opFromJSON,
} from './types/queryops'
import errs, {errToJSON, errFromJSON} from './err'

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

interface SubPlus extends I.Subscription {
  _ref: N.Ref,
  _qtype: I.QueryType,
  [k: string]: any
}

const serve = (reader: Readable, writer: Writable, store: I.Store) => {
  const subForRef = new Map<N.Ref, SubPlus>()
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

  function subListener(updates: I.SubUpdate, resultingVersion: I.FullVersionRange, _sub: I.Subscription) {
    const sub = _sub as SubPlus
    const type = queryTypes[sub._qtype]

    // vomit emoji.
    write(updates.type === 'aggregate' ? {
      a: 'sub update', ref: sub._ref, rv: resultingVersion, type: 'aggregate',
      txn: opToJSON(type.r, updates.txn),
      v: updates.versions,
    } : {
      a: 'sub update', ref: sub._ref, rv: resultingVersion, type: 'txns',
      txns: updates.txns.map(({versions, txn}) => ({
        v: versions,
        txn: opToJSON(type.r, txn),
      })),
    })
  }

  reader.on('data', (msg: N.CSMsg) => {
    // console.log('Got CS data', msg)
    switch (msg.a) {
      case 'fetch': {
        const {ref, qtype, query, opts} = (msg as N.FetchRequest)
        assert(store.capabilities.queryTypes.has(qtype)) // TODO: better error handling

        const type = queryTypes[qtype]
        if (!type) return write({a: 'err', ref, err: errToJSON(new errs.InvalidDataError('Invalid query type'))})
        const q = snapFromJSON(type.q, query)
        store.fetch(qtype, q, opts, (err, data) => {
          if (err) {
            console.warn('Error in fetch', err)
            write({a: 'err', ref, err: errToJSON(err)})
          } else {
            write({
              a: 'fetch',
              ref,
              results: snapToJSON(type.r, data!.results),
              queryRun: snapToJSON(type.q, data!.queryRun),
              versions: data!.versions
            })
          }
        })
        break
      }

      case 'getops': {
        const {ref, qtype, query, v, opts} = <N.GetOpsRequest>msg
        assert(store.capabilities.queryTypes.has(qtype))

        const type = queryTypes[qtype]
        if (!type) return write({a: 'err', ref, err: errToJSON(new errs.InvalidDataError('Invalid query type'))})
        const q = snapFromJSON(type.q, query)
        store.getOps(qtype, q, v, opts, (err, data) => {
          if (err) return write({a: 'err', ref, err: errToJSON(err)})

          const jsonTxns = data!.ops.map(txn => (<N.NetTxnWithMeta>[
            opToJSON(type.r, txn.txn),
            txn.versions,
          ]))
          write({a: 'getops', ref, ops: jsonTxns, v: data!.versions})
        })

        break
      }

      case 'mutate': {
        const {ref, mtype, txn, v, opts} = <N.MutateRequest>msg
        assert(store.capabilities.mutationTypes.has(mtype))
        const type = resultTypes[mtype]
        assert(type)

        store.mutate(mtype, opFromJSON(type, txn), v, opts, (err, v) => {
          // console.log('mutate fired! got results')
          if (err) return write({a:'err', ref, err: errToJSON(err)})
          else write({a: 'mutate', ref, v:v!})
        })
        break
      }

      case 'sub create': {
        const {ref, qtype, query, opts} = msg
        const sub = store.subscribe(qtype, query, opts, subListener) as SubPlus
        sub._qtype = qtype // Kinda hacky, but eh its fine. I own the sub here anyway.
        sub._ref = ref
        assert(!subForRef.has(ref))
        subForRef.set(ref, sub)
        break
      }

      case 'sub next': {
        const {ref, opts} = msg
        const sub = subForRef.get(ref)!
        assert(sub) // TODO
        const type = queryTypes[sub._qtype]
        sub.cursorNext(opts, (err, data) => {
          if (err) return write({a: 'sub next err', ref, err: errToJSON(err)})
          // const type = registry[sub.
          else write({
            a: 'sub next',
            ref,
            q: snapToJSON(type.q, data!.activeQuery),
            v: data!.activeVersions,
            c: sub.isComplete()
          })
        })
        break
      }

      case 'sub cancel': {
        const {ref} = msg
        const sub = subForRef.get(ref)
        // TODO: What should we do for invalid refs? Right now we're silently ignoring them..?
        if (sub != null) {
          sub.cancel()
          subForRef.delete(ref)
        }
        break
      }

      default:
        protoErr(new Error('Invalid msg: ' + msg))
    }
  })
}

export default (store: I.Store) => {
  // console.log('made store')
  return net.createServer(c => {
    // console.log('got connection')
    const writer = msgpack.createEncodeStream()
    writer.pipe(c)

    const reader = msgpack.createDecodeStream()
    c.pipe(reader)

    serve(reader, writer, store)
  })
}