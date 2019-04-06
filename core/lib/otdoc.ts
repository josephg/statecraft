// This is a wrapper around a single value store which implements simple
// operational transformation using a specified type.

// This code is based on ShareJS's doc type here:
// https://github.com/josephg/ShareJS/blob/master/lib/client/doc.js

import * as I from './interfaces'
import fieldOps from './types/field'
import {typeOrThrow} from './typeregistry'
import genSource from './gensource'
import { bitHas } from './bit';

const xf = <Val, Op>(type: I.AnyOTType, client: Op | null, server: I.SingleOp<Val> | null): [Op | null, I.SingleOp<Val> | null] => {
  if (client == null || server == null) return [client, server]

  // In this case, we're in for some fun. There are some local operations
  // which are totally invalid - either the client continued editing a
  // document that someone else deleted or a document was created both on the
  // client and on the server. In either case, the local document is way
  // invalid and the client's ops are useless.
  //
  // The client becomes a no-op, and we keep the server op entirely.
  if (server.type === 'set' || server.type === 'rm') return [null, server]

  // We only get here if either the server or client ops are no-op. Carry on,
  // nothing to see here.
  // if (!server.op || !client.op) return;

  // They both edited the document. This is the normal case for this function -
  // as in, most of the time we'll end up down here.
  if (type.transformX) {
    const [c, s] = type.transformX(client, server.data)
    return [c, {type: type.name, data: s}]
  } else {
    const c = type.transform!(client, server.data, 'left')
    const s = type.transform!(server.data, client, 'right')
    return [c, {type: type.name, data: s}]
  }
}

const vAtIdx = <V>(i: number, v: V): (V | null)[] => {
  const result = []
  result[i] = v
  return result
}

const otDoc = async <Val, Op>(
    store: I.Store<Val>,
    typeName: string,
    opts: {
      source?: I.Source,
      initial?: {
        val: any,
        version: I.FullVersion | I.Version,
      }
    },
    listener: (op: I.SingleOp<Val>, resultingVal: any) => void
) => {
  const capabilities = store.storeInfo.capabilities
  if (!bitHas(capabilities.queryTypes, I.QueryType.Single)
      || !bitHas(capabilities.mutationTypes, I.ResultType.Single)) {
    throw Error('Wrapped store does not support type')
  }

  const source = opts.source || store.storeInfo.sources[0]!
  const sourceId = store.storeInfo.sources.indexOf(source)
  if (sourceId < 0) throw Error('Requested source not found in store')

  const type = typeOrThrow(typeName)
  if (!type.compose || !type.transform) throw Error('Missing compose / transform on your OT type')

  // TODO: knownDocs
  const sub = store.subscribe({type: I.QueryType.Single, q: true}, {
    fromVersion: opts.initial
      ? (opts.initial.version instanceof Uint8Array
        ? vAtIdx(sourceId, opts.initial.version)
        : opts.initial.version
      ) : undefined,
  })

  const initial = opts.initial
  let doc: any = initial ? initial.val : null

  let version = initial
    ? (initial.version instanceof Uint8Array ? initial.version : initial.version[sourceId])
    : new Uint8Array()

  // Written assuming the type has a compose() function.
  let pendingTxn: Op | null = null
  let inflightTxn: Op | null = null
  let inflightUid: string | null = null

  const idStem = genSource() + '_'
  let nextId = 0

  let readyResolve: null | (() => void) = null
  const ready = opts.initial ? Promise.resolve(opts.initial.val) : new Promise(resolve => readyResolve = resolve)


  const processTxn = (serverOp: I.SingleOp<Val> | null, newVersion: I.Version) => {
    // if (false /* TODO */) { return } // If its mine, we're done.

    if (inflightTxn) [inflightTxn, serverOp] = xf(type, inflightTxn, serverOp)
    if (pendingTxn) [pendingTxn, serverOp] = xf(type, pendingTxn, serverOp)
    version = newVersion

    // TODO: Handle rollback, if the server nuked our edit.

    if (serverOp != null) {
      doc = fieldOps.apply(doc, serverOp)
      listener(serverOp, doc)
    }
  }

  const flush = async () => {
    if (inflightTxn != null || pendingTxn == null) return

    inflightTxn = pendingTxn
    pendingTxn = null
    inflightUid = idStem + (nextId++)
    // For now I'm assuming this doesn't fail.
    // TODO: Add metadata to this.
    /*const resultingVersion =*/ await store.mutate(I.ResultType.Single,
        {type: typeName, data: inflightTxn},
        vAtIdx(sourceId, version),
        {meta: {uid: inflightUid}}) // Returns the version # of our op
    // inflightTxn = null

    // flush()
    console.log('flush -> pending', !!pendingTxn, 'inflight', !!inflightTxn)
  }

  ;(async () => {
    for await (const update of sub) {
      console.log('got update', update)
      let tryFlush = false

      if (update.replace) {
        // This situation with versions is a huge mess. What is authoritative?
        // And what do we do if the version doesn't contain the named source here??
        processTxn({type: 'set', data: update.replace.with}, update.replace.versions[sourceId]!)

        if (readyResolve != null) {
          readyResolve!()
          readyResolve = null
        }
      }

      update.txns.forEach(txn => {
        // console.log('txn', txn)

        // Ignore any ops we've generated locally. This is not quite
        // sufficient - if we want to handle reconnects properly we'll also
        // need to store previous id stems somewhere.
        if (txn.meta.uid && txn.meta.uid.startsWith(idStem)) {
          if (txn.meta.uid === inflightUid) {
            // We've seen our own op on the op stream. Mark it as confirmed and try to send more.
            inflightTxn = inflightUid = null
            tryFlush = true
          }
          return
        }

        const innerTxn = txn.txn as I.SingleTxn<Val>
        if (Array.isArray(innerTxn)) innerTxn.forEach(op => processTxn(op, txn.versions[sourceId]!))
        else processTxn(innerTxn, txn.versions[sourceId]!)
      })

      // Could instead do this using the txn - its equivalent.
      if (update.toVersion[sourceId]) version = update.toVersion[sourceId]

      if (tryFlush) flush()

      console.log('on update pending', !!pendingTxn, 'inflight', !!inflightTxn)
    }
  })()

  await ready

  return {
    ready,
    initial: doc,
    get() { return doc },
    apply(op: Op) {
      if (type.normalize) op = type.normalize(op)

      if (pendingTxn == null) pendingTxn = op
      else pendingTxn = type.compose!(pendingTxn, op)

      doc = type.apply(doc, op)

      setTimeout(flush, 0)
    },
  }
}

export default otDoc