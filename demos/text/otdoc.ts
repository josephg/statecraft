// This is a wrapper around a single value store which implements simple
// operational transformation using a specified type.

// This code is based on ShareJS's doc type here:
// https://github.com/josephg/ShareJS/blob/master/lib/client/doc.js

import * as I from '../../lib/types/interfaces'
import * as T from '../../lib/types/type'
import fieldOps from '../../lib/types/fieldops'
import {typeOrThrow} from '../../lib/types/registry'

const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
const genIdStem = () => {
  let result = ''
  for (let i = 0; i < 8; i++) result += alphabet[(Math.random() * alphabet.length)|0]
  return result + '_'
}


const xf = <Op>(type: T.AnyOTType, client: Op | null, server: I.SingleOp | null): [Op | null, I.SingleOp | null] => {
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

const otDoc = async <Op>(
    store: I.Store,
    typeName: string,
    opts: {
      source?: I.Source,
    },
    listener: (op: I.SingleOp, resultingVal: any) => void
) => {
  const capabilities = store.storeInfo.capabilities
  if (!capabilities.queryTypes.has('single')
      || !capabilities.mutationTypes.has('single')) {
    throw Error('Wrapped store does not support type')
  }

  const source = opts.source || store.storeInfo.sources[0]!

  const type = typeOrThrow(typeName)
  if (!type.compose || !type.transform) throw Error('Missing compose / transform on your OT type')

  // TODO: knownDocs
  const sub = store.subscribe({type: 'single', q: true}, {
    // knownDocs: true,
    // knownAtVersions: config.initialVersions,
  })
  await sub.cursorAll() // We should have the document by the time this returns.

  let doc: any = null
  let version: number = -1

  // Written assuming the type has a compose() function.
  let pendingTxn: Op | null = null
  let inflightTxn: Op | null = null
  let inflightUid: string | null = null

  const idStem = genIdStem()
  let nextId = 0

  let readyResolve: null | (() => void) = null
  const ready = new Promise(resolve => readyResolve = resolve)


  const processTxn = (serverOp: I.SingleOp | null, newVersion: number) => {
    // if (false /* TODO */) { return } // If its mine, we're done.

    if (inflightTxn) [inflightTxn, serverOp] = xf(type, inflightTxn, serverOp)
    if (pendingTxn) [pendingTxn, serverOp] = xf(type, pendingTxn, serverOp)
    version = newVersion

    if (serverOp != null) {
      doc = fieldOps.apply(doc, serverOp)
      listener(serverOp, doc)
    }
  }

  const flush = async () => {
    if (inflightTxn || pendingTxn == null) return

    inflightTxn = pendingTxn
    pendingTxn = null
    inflightUid = idStem + (nextId++)
    // For now I'm assuming this doesn't fail.
    // TODO: Add metadata to this.
    /*const resultingVersion =*/ await store.mutate('single',
        {type: typeName, data: inflightTxn},
        {[source]: version},
        {uid: inflightUid}) // Returns the version # of our op
    // inflightTxn = null

    // flush()
  }

  ;(async () => {
    for await (const update of sub) {
      console.log('got update', update)
      let tryFlush = false

      if (update.replace) {
        // This situation with versions is a huge mess. What is authoritative?
        processTxn({type: 'set', data: update.replace.with}, update.resultingVersions[source].to)

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
        if (txn.uid && txn.uid.startsWith(idStem)) {
          if (txn.uid === inflightUid) {
            // We've seen our own op on the op stream. Mark it as confirmed and try to send more.
            inflightTxn = inflightUid = null
            tryFlush = true
          }
          return
        }

        const innerTxn = txn.txn as I.SingleTxn
        if (Array.isArray(innerTxn)) innerTxn.forEach(op => processTxn(op, txn.versions[source]))
        else processTxn(innerTxn, txn.versions[source])
      })

      if (update.resultingVersions[source]) {
        version = update.resultingVersions[source].to
      }

      if (tryFlush) flush()
    }
  })()

  await ready

  return {
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