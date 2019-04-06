
const listen = async () => {
  const localStore = await kvStore()
  server(localStore).listen(3334)
  console.log('listening on 3334')
}

const testNet = async () => {
  await listen()

  const store = await remoteStore(3334, 'localhost')
  const results = await store.fetch({type: I.QueryType.KV, q:new Set(['x'])})
  console.log(results)
}
