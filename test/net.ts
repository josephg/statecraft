import 'mocha'
import kvStore from '../lib/stores/kvmem'
import augment from '../lib/augment'
import createServer from '../lib/net/tcpserver'
import connectStore from '../lib/stores/tcpclient'
import runTests from './common'
import * as I from '../lib/interfaces'
import {AddressInfo} from 'net'

// TODO: This is currently using a simple TCP server & client and sending
// messages over msgpack. We should also test the JSON encoding path, because
// there are a bunch of errors which can show up there that we don't catch
// here. (Eg, version encoding bugs)
describe('net', () => {
  const serverForStore = new WeakMap<I.Store<any>, any>()
  runTests(() => new Promise((resolve, reject) => kvStore().then(s => {
    const store = augment(s)
    const server = createServer(store)
    server.listen(0, () => {
      const port = (server.address() as AddressInfo).port
      connectStore(port, 'localhost').then(remoteStore => {
        serverForStore.set(remoteStore!, server)
        resolve(remoteStore!)
      }, err => {
        console.error('ERROR: Could not connect to local server', err)
        server.close()
        return reject(err)
      })
    })
  })), (store) => serverForStore.get(store).close())

  it('returns an error if connection fails before hello is received')
})