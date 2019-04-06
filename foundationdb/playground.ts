
import * as fdb from 'foundationdb'

fdb.setAPIVersion(600)

const getOps = async () => {
  const fdbConn = fdb.openSync().at('textdemo') // TODO: Directory layer stuff.
  const backend = await fdbStore<string>(fdbConn)

  // const backend = lmdbStore(
  const store = backend
  const source = store.storeInfo.sources[0]
  const ops = await store.getOps({type: I.QueryType.KV, q:new Set(['asdf'])}, [{from: Buffer.alloc(0), to:  Buffer.alloc(0)}])

  let doc: any = null
  ops.ops.forEach(o => {
    const op = (o.txn as I.KVTxn<string>).get('asdf') as I.SingleOp<string>
    if (op.type === 'set') doc = op.data
    else if (op.type === 'text-unicode') doc = textType.type.apply(doc, op.data)
    console.log({
      version: Array.from(o.versions[0]!),
      len: doc.length, op: op.data, meta: o.meta}, doc)
  })

  store.close()
}
