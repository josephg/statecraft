import 'mocha'
import kvStore from '../lib/stores/kvmem'
import augment from '../lib/augment'
import createServer from '../lib/tcpserver'
import connectStore from '../lib/stores/tcpclient'
import runTests from './common'
import * as I from '../lib/types/interfaces'

describe('remote', () => {
  const serverForStore = new WeakMap<I.Store, any>()
  runTests(() => new Promise((resolve, reject) => {
    const store = augment(kvStore())
    const server = createServer(store)
    server.listen(0, () => {
      const port = server.address().port
      connectStore(port, 'localhost', (err, remoteStore) => {
        if (err) {
          server.close()
          return reject(err)
        } else {
          serverForStore.set(remoteStore!, server)
          resolve(remoteStore!)
        }
      })
    })
  }), (store) => serverForStore.get(store).close())
})