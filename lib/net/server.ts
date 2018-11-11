import * as I from '../types/interfaces'
import * as T from '../types/type'
import * as N from './netmessages'

import {queryToNet, queryFromNet} from './util'
import {
  queryTypes, resultTypes,
  snapToJSON, snapFromJSON,
  opToJSON, opFromJSON,
  getQueryData
} from '../types/queryops'
import {TinyReader, TinyWriter} from './tinystream'
import errs, {errToJSON, errFromJSON} from '../err'

// import {Readable, Writable} from 'stream'
import assert = require('assert')

const capabilitiesToJSON = (c: I.Capabilities): any[] => {
  return [
    Array.from(c.queryTypes),
    Array.from(c.mutationTypes)
  ]
}

const txnsWithMetaToNet = (type: T.Type<any, I.Txn>, txns: I.TxnWithMeta[]): N.NetTxnWithMeta[] => (
  txns.map(txn => (<N.NetTxnWithMeta>[
    opToJSON(type, txn.txn),
    txn.versions,
    txn.meta,
  ]))
)

export default function serve(reader: TinyReader<N.CSMsg>, writer: TinyWriter<N.SCMsg>, store: I.Store): void {
  if (reader.isClosed) return
  
  const subForRef = new Map<N.Ref, I.Subscription>()

  const protoErr = (err: Error) => {
    console.error('Invalid client', err)
  }

  const write = (data: N.SCMsg) => {
    writer.write(data)
  }

  const writeErr = (ref: N.Ref, err: Error) => {
    console.warn('Error processing client data', err)
    write({a: 'err', ref, err: errToJSON(err)})
  }

  // let closed = false
  reader.onclose = () => {
    for (const sub of subForRef.values()) {
      sub.iter.return()
    }
    subForRef.clear()
    // closed = true
  }

  // First we send the capabilities
  write({
    a: 'hello',
    p: 'statecraft',
    pv: 0,
    sources: store.storeInfo.sources,
    capabilities: capabilitiesToJSON(store.storeInfo.capabilities),
  })

  reader.onmessage = (msg: N.CSMsg) => {
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
          write({
            a: 'getops',
            ref,
            ops: txnsWithMetaToNet(type.r, data!.ops),
            v: data!.versions
          })
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
        const innerOpts: I.SubscribeOpts = {
          knownDocs: Array.isArray(opts.kd) ? new Set(opts.kd) : opts.kd,
          knownAtVersions: opts.kv,
        }
        const sub = store.subscribe(query, innerOpts)
        const type = queryTypes[query.type]

        assert(!subForRef.has(ref)) // TODO
        subForRef.set(ref, sub)

        ;(async () => {
          for await (const updates of sub.iter) {

            const msg: N.SCMsg = {
              a: 'sub update', ref, rv: updates.resultingVersions,
              txns: txnsWithMetaToNet(type.r, updates.txns),
            }
            if (updates.replace) {
              msg.q = queryToNet(updates.replace.q)
              msg.r = snapToJSON(type.r, updates.replace.with)
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
  }
}