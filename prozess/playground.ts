
const connectProzess = (): Promise<PClient> => new Promise((resolve, reject) => {
  const client = reconnecter(9999, 'localhost', err => {
    if (err) reject(err)
    else resolve(client)
  }) as PClient
})

const testProzess = async () => {
  const client = await connectProzess()
  const store = prozessOps(client)

  const sub = store.subscribe({type: I.QueryType.AllKV, q: true})
  ;(async () => {
    for await (const cu of sub) {
      console.log('cu', cu)
    }
  })

  const txn = new Map([['x', {type:'set', data: {x: 10}}]])
  const v = await store.mutate(I.ResultType.KV, txn, [new Uint8Array()])
  console.log('mutate cb', v)
}


const retryTest = async () => {
  const concurrentWrites = 10

  const client = await connectProzess()
  // const localStore = augment(await lmdbStore(prozessOps(client), process.argv[2] || 'testdb'))
  const localStore = await kvStore<number>()

  // Using net to give it a lil' latency.
  // const s = server(localStore).listen(3334)
  // const store = await remoteStore(3334, 'localhost')

  const store = localStore

  await store.mutate(I.ResultType.KV, setSingle('x', 0))
  // await db.set('x', numToBuf(0))

  let txnAttempts = 0
  const sync = await Promise.all(new Array(concurrentWrites).fill(0).map((_, i) => (
    doTxn(store, async txn => {
      const val = await txn.get('x')
      txn.set('x', val+1)
      return txnAttempts++
    })
  )))

  const result = await doTxn(store, txn => txn.get('x'))
  assert.strictEqual(result, concurrentWrites)

  // This doesn't necessarily mean there's an error, but if there weren't
  // more attempts than there were increments, the database is running
  // serially and this test is doing nothing.
  assert(txnAttempts > concurrentWrites)

  console.log('attempts', txnAttempts)
  console.log(sync)

  client.close()
  store.close()
  // s.close()
}

