import 'mocha'
import kvStore from '../lib/stores/kvmem'
import augment from '../lib/augment'
import createServer from '../lib/net/tcpserver'
import connectStore from '../lib/stores/tcpclient'
import runTests from './common'
import * as I from '../lib/interfaces'
import {AddressInfo} from 'net'

describe('net', () => {
  const serverForStore = new WeakMap<I.Store, any>()
  runTests(() => new Promise((resolve, reject) => {
    const store = augment(kvStore())
    const server = createServer(store)
    server.listen(0, () => {
      const port = (server.address() as AddressInfo).port
      connectStore(port, 'localhost').then(remoteStore => {
        serverForStore.set(remoteStore!, server)
        resolve(remoteStore!)
      }, err => {
        server.close()
        return reject(err)
      })
    })
  }), (store) => serverForStore.get(store).close())
})