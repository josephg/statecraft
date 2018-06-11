import * as I from '../types/interfaces'
import * as N from './netmessages'

import {queryToNet, queryFromNet} from './util'
import {
  queryTypes, resultTypes,
  snapToJSON, snapFromJSON,
  opToJSON, opFromJSON,
  getQueryData
} from '../types/queryops'
import errs, {errToJSON, errFromJSON} from '../err'

import {Readable, Writable, Transform} from 'stream'
import assert = require('assert')

const capabilitiesToJSON = (c: I.Capabilities): any[] => {
  return [
    Array.from(c.queryTypes),
    Array.from(c.mutationTypes)
  ]
}

export default function serve(reader: Readable, writer: Writable, store: I.Store) {
  const subForRef = new Map<N.Ref, I.Subscription>()
  // let finished = false

  const protoErr = (err: Error) => {
    console.error('Invalid client', err)
  }

  const write = (data: N.SCMsg) => {
    writer.write(data)

    // Work around this bug:
    // https://github.com/kawanet/msgpack-lite/issues/80
    if ((writer as any).encoder) {
      (writer as any).encoder.flush()
    }
  }

  const writeErr = (ref: N.Ref, err: Error) => {
    console.warn('Error processing client data', err)
    write({a: 'err', ref, err: errToJSON(err)})
  }

  // First we send the capabilities
  write({
    a: 'hello',
    p: 'statecraft',
    pv: 0,
    sources: store.storeInfo.sources,
    capabilities: capabilitiesToJSON(store.storeInfo.capabilities),
  })

  reader.on('data', (msg: N.CSMsg) => {
    // console.log('Got CS data', msg)
    switch (msg.a) {
      case 'fetch': {
        const {ref, query: netQuery, opts} = (msg as N.FetchRequest)
        const query = queryFromNet(netQuery)
        const qtype = query.type
        if (!store.storeInfo.capabilities.queryTypes.has(qtype)) {
          return writeErr(ref, new errs.UnsupportedTypeError(`query type ${qtype} not supported in fetch`))
        }

        const type = queryTypes[qtype]
        if (!type) return write({a: 'err', ref, err: errToJSON(new errs.InvalidDataError('Invalid query type'))})

        store.fetch(query, opts).then(data => {
          write({
            a: 'fetch',
            ref,
            results: snapToJSON(type.r, data!.results),
            queryRun: queryToNet(data.queryRun),
            versions: data!.versions
          })
        }, err => {
          writeErr(ref, err)
        })
        break
      }

      case 'getops': {
        const {ref, query: netQuery, v, opts} = <N.GetOpsRequest>msg
        const query = queryFromNet(netQuery)
        const qtype = query.type

        if (!store.storeInfo.capabilities.queryTypes.has(qtype)) {
          return writeErr(ref, new errs.UnsupportedTypeError(`query type ${qtype} not supported in getops`))
        }

        const type = queryTypes[qtype]
        if (!type) return writeErr(ref, new errs.InvalidDataError('Invalid query type'))

        store.getOps(query, v, opts).then(data => {
          const jsonTxns = data!.ops.map(txn => (<N.NetTxnWithMeta>[
            opToJSON(type.r, txn.txn),
            txn.versions,
          ]))
          write({a: 'getops', ref, ops: jsonTxns, v: data!.versions})
        }, err => {
          writeErr(ref, err)
        })

        break
      }

      case 'mutate': {
        const {ref, mtype, txn, v, opts} = <N.MutateRequest>msg
        if (!store.storeInfo.capabilities.mutationTypes.has(mtype)) {
          return writeErr(ref, new errs.UnsupportedTypeError(`mutation type ${mtype} not supported`))
        }

        const type = resultTypes[mtype]
        assert(type)

        store.mutate(mtype, opFromJSON(type, txn), v, opts).then(v => {
          write({a: 'mutate', ref, v:v!})
        }, err => {
          writeErr(ref, err)
        })
        break
      }

      case 'sub create': {
        const {ref, query: netQuery, opts} = msg
        const query = queryFromNet(netQuery)
        const sub = store.subscribe(query, opts)
        const type = queryTypes[query.type]

        assert(!subForRef.has(ref)) // TODO
        subForRef.set(ref, sub)

        ;(async () => {
          for await (const updates of sub.iter) {

            const msg: N.SCMsg = {
              a: 'sub update', ref, rv: updates.resultingVersions,
              q: updates.queryChange == null ? null : queryToNet(updates.queryChange),
              txns: updates.txns.map(({versions, txn}) => ({
                v: versions,
                txn: opToJSON(type.r, txn),
              })),
            }
            if (updates.replace) {
              msg.r = snapToJSON(type.r, updates.replace)
            }
            write(msg)
          }
          subForRef.delete(ref)
        })()
        break
      }

      case 'sub next': {
        const {ref, opts} = msg
        const sub = subForRef.get(ref)!
        assert(sub) // TODO
        sub.cursorNext(opts || {}).then(data => {
          write({
            a: 'sub next',
            ref,
            q: queryToNet(data!.activeQuery),
            v: data!.activeVersions,
            c: sub.isComplete()
          })
        }, err => {
          write({a: 'sub next err', ref, err: errToJSON(err)})
        })
        break
      }

      case 'sub cancel': {
        const {ref} = msg
        const sub = subForRef.get(ref)
        // TODO: What should we do for invalid refs? Right now we're silently ignoring them..?
        if (sub != null) {
          sub.iter.return()
        }
        break
      }

      default:
        protoErr(new Error('Invalid msg: ' + msg))
    }
  })
}