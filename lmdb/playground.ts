
const testLmdb = async () => {
  const client = await connectProzess()

  const store = await lmdbStore(prozessOps(client), process.argv[2] || 'testdb')

  const sub = store.subscribe({type:I.QueryType.KV, q:new Set(['x', 'q', 'y'])}, {})
  ;(async () => {
    for await (const data of sub) {
      console.log('subscribe data', inspect(data, false, 10, true))
    }
  })()

  // store.onTxn = (source, from, to, type, txn) => {
  //   console.log('ontxn', source, from, to, type, txn)
  // }
  const txn = new Map([['a', {type:'inc', data: 10}]])
  // const txn = new Map([['x', {type:'set', data: {ddd: (Math.random() * 100)|0}}]])
  // const txn = new Map([['q', {type:'set', data: (Math.random() * 100)|0}]])
  console.log('source', store.storeInfo.sources)
  const v = await store.mutate(I.ResultType.KV, txn, [new Uint8Array()])
  console.log('mutate cb', v)

  const results = await store.fetch({type:I.QueryType.AllKV, q: true})
  console.log('fetch results', results)

  // store.close()
}

