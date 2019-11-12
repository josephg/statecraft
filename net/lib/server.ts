import {I, queryTypes, resultTypes, err, errToJSON, bitHas} from '@statecraft/core'
import * as N from './netmessages'

import {
  queryToNet, queryFromNet,
  fullVersionToNet, fullVersionFromNet,
  fullVersionRangeToNet, fullVersionRangeFromNet,
} from './util'
import {TinyReader, TinyWriter, listen} from './tinystream'

// import {Readable, Writable} from 'stream'
import assert from 'assert'

const capabilitiesToJSON = (c: I.Capabilities): any[] => [c.queryTypes, c.mutationTypes]

const txnsWithMetaToNet = <Val>(type: I.ResultOps<any, any, I.Txn<Val>>, txns: I.TxnWithMeta<Val>[]): N.NetTxnWithMeta[] => (
  txns.map(txn => (<N.NetTxnWithMeta>[
    type.opToJSON(txn.txn),
    fullVersionToNet(txn.versions),
    txn.meta,
  ]))
)

export default function serve<Val>(reader: TinyReader<N.CSMsg>, writer: TinyWriter<N.SCMsg>, store: I.Store<Val>): void {
  if (reader.isClosed) return
  
  const subForRef = new Map<N.Ref, I.Subscription<Val>>()

  const protoErr = (err: Error) => {
    console.warn(err.message)
    if (reader.destroy) reader.destroy(err)
    if (writer.destroy) writer.destroy(err)
    writer.close()
  }

  const write = (data: N.SCMsg) => {
    // console.log('S->C data', data)
    writer.write(data)
  }

  const writeErr = (ref: N.Ref, e: Error) => {
    // Should probably ignore most errors here.
    if (!(e instanceof err.WriteConflictError)) {
      console.warn('Warning: Error processing client data', e)
    }
    write({a: N.Action.Err, ref, err: errToJSON(e)})
  }

  // let closed = false
  reader.onClose = () => {
    // console.log('client reader closed')
    for (const sub of subForRef.values()) {
      sub.return()
    }
    subForRef.clear()
    // closed = true
  }

  // First we send the capabilities
  write({
    a: N.Action.Hello,
    p: 'statecraft',
    pv: 0,
    uid: store.storeInfo.uid,
    sources: store.storeInfo.sources,
    m: store.storeInfo.sourceIsMonotonic,
    capabilities: capabilitiesToJSON(store.storeInfo.capabilities),
  })

  listen(reader, (msg: N.CSMsg) => {
    // console.log('C->S data', msg)
    
    switch (msg.a) {
      case N.Action.Fetch: {
        const {ref, query: netQuery, opts} = (msg as N.FetchRequest)
        const query = queryFromNet(netQuery) as I.Query
        const qtype = query.type
        if (!bitHas(store.storeInfo.capabilities.queryTypes, qtype)) {
          return writeErr(ref, new err.UnsupportedTypeError(`query type ${qtype} not supported in fetch`))
        }

        const type = queryTypes[qtype]
        if (!type) return write({a: N.Action.Err, ref, err: errToJSON(new err.InvalidDataError('Invalid query type'))})

        store.fetch(query, opts).then(data => {
          write({
            a: N.Action.Fetch,
            ref,
            results: type.resultType.snapToJSON(data.results),
            bakedQuery: data.bakedQuery ? queryToNet(data.bakedQuery) : undefined,
            versions: fullVersionRangeToNet(data.versions)
          })
        }, err => {
          writeErr(ref, err)
        })
        break
      }

      case N.Action.GetOps: {
        const {ref, query: netQuery, v, opts} = <N.GetOpsRequest>msg
        const query = queryFromNet(netQuery) as I.Query
        const qtype = query.type

        if (!bitHas(store.storeInfo.capabilities.queryTypes, qtype)) {
          return writeErr(ref, new err.UnsupportedTypeError(`query type ${qtype} not supported in getops`))
        }

        const type = queryTypes[qtype]
        if (!type) return writeErr(ref, new err.InvalidDataError('Invalid query type'))

        store.getOps(query, fullVersionRangeFromNet(v), opts).then(data => {
          write({
            a: N.Action.GetOps,
            ref,
            ops: txnsWithMetaToNet(type.resultType, data.ops),
            v: fullVersionRangeToNet(data.versions)
          })
        }, err => {
          writeErr(ref, err)
        })

        break
      }

      case N.Action.Mutate: {
        const {ref, mtype, txn, v, opts} = <N.MutateRequest>msg
        if (!bitHas(store.storeInfo.capabilities.mutationTypes, mtype)) {
          return writeErr(ref, new err.UnsupportedTypeError(`mutation type ${mtype} not supported`))
        }

        const type = resultTypes[mtype]
        assert(type)

        store.mutate(mtype, type.opFromJSON(txn), fullVersionFromNet(v), opts).then(v => {
          write({a: N.Action.Mutate, ref, v:fullVersionToNet(v)})
        }, err => {
          // console.log('... in mutate', err.stack)
          writeErr(ref, err)
        })
        break
      }

      case N.Action.SubCreate: {
        const {ref, query: netQuery, opts} = msg
        const query = queryFromNet(netQuery) as I.Query
        const innerOpts: I.SubscribeOpts = {
          supportedTypes: opts.st ? new Set(opts.st) : undefined,
          fromVersion: opts.fv === 'c' ? 'current'
            : opts.fv == null ? undefined
            : fullVersionFromNet(opts.fv),
        }

        let sub
        try {
          sub = store.subscribe(query, innerOpts)
        } catch (e) {
          writeErr(ref, e)
          break
        }
        const type = queryTypes[query.type]

        assert(!subForRef.has(ref)) // TODO
        subForRef.set(ref, sub)
        ;(async () => {
          try {
            for await (const update of sub) {
              const msg: N.SCMsg = {
                a: N.Action.SubUpdate, ref,
                txns: txnsWithMetaToNet(type.resultType, update.txns),
                tv: fullVersionToNet(update.toVersion),
                u: update.caughtUp,
              }
              if (update.replace) {
                msg.q = queryToNet(update.replace.q)
                msg.r = type.resultType.snapToJSON(update.replace.with)
                msg.rv = fullVersionToNet(update.replace.versions)
              }
              write(msg)
            }
            // console.log('server: sub stopped')
          } catch (e) {
            writeErr(ref, e)
          }
          subForRef.delete(ref)
          write({a: N.Action.SubClose, ref})
        })()
        break
      }

      case N.Action.SubClose: {
        const {ref} = msg
        const sub = subForRef.get(ref)
        // TODO: What should we do for invalid refs? Right now we're silently ignoring them..?
        // console.log('sub.return()')
        if (sub != null) sub.return() // This will confirm via 'sub ret'.
        break
      }

      default:
        protoErr(new Error('Invalid msg: ' + msg))
    }
  })
}