import {I, stores} from '@statecraft/core'
import server from './lib/tcpserver'
import remoteStore from './lib/stores/tcpclient'

const listen = async () => {
  const localStore = await stores.kvmem()
  server(localStore).listen(3334)
  console.log('listening on 3334')
}

const testNet = async () => {
  await listen()

  const store = await remoteStore(3334, 'localhost')
  const results = await store.fetch({type: I.QueryType.KV, q:new Set(['x'])})
  console.log(results)
}
