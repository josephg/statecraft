import * as I from '../interfaces'
import {TinyReader, TinyWriter} from '../net/tinystream'
import * as N from '../net/netmessages'
import createStore, {NetStore, ClientOpts} from '../net/client'
import singleMem, {setSingle} from './singlemem'

const wait = (timeout: number) => new Promise(resolve => setTimeout(resolve, timeout))

// Connection states:
// - connected
// - connecting
// - waiting
// - stopped

const reconnector = (connect: (() => [TinyReader<N.SCMsg>, TinyWriter<N.CSMsg>])): [I.SimpleStore, Promise<I.Store>] => {
  // This is a tiny store that the client can use to track & display whether
  // or not we're currently connected. Ite tempting to make a metastore be a
  // default feature.
  const status = singleMem('waiting')
  let innerStore: NetStore | null = null
  let shouldReconnect = true

  // const initialStoreP = 
  // initialStoreP.then(store => { innerStore = store; })

  const ready: Promise<I.Store> = new Promise((resolve, reject) => {
    // Should this return a [reader, writer] promise?
    const [r, w] = connect()

    const opts: ClientOpts = {
      preserveState: true,
      onClose() {
        // We don't clear innerStore yet - all requests will still go there
        // until we change the guard.
        setSingle(status, 'waiting')

        // This is pretty rough.
        ;(async () => {
          while (shouldReconnect) {
            console.log('... trying to reconnect ...')
            const [r, w] = connect()

            try {
              setSingle(status, 'connecting')
              await createStore(r, w, {
                ...opts,
                restoreFrom: innerStore!,
                syncReady(store) {
                  // Ok, we've reconnected & gotten our hello message.

                  // We have to initialize here to avoid an event loop frame
                  // where innerStore is set incorrectly.
                  innerStore = store
                  setSingle(status, 'connected')
                  console.warn('Reconnected')
                }
              })
              break
            } catch (e) {
              console.warn('Reconnection failed', e)
            }

            setSingle(status, 'waiting')
            await wait(5000)
          }
        })()
      },
    }


    setSingle(status, 'connecting')
    createStore(r, w, opts).then(initialStore => {
      innerStore = initialStore
      setSingle(status, 'connected')

      // This is basically a proxy straight to innerStore.
      const s: I.Store = {
        storeInfo: initialStore.storeInfo,
        fetch(...args) { return innerStore!.fetch(...args) },
        getOps(...args) { return innerStore!.getOps(...args) },
        mutate(...args) { return innerStore!.mutate(...args) },
        subscribe(...args) { return innerStore!.subscribe(...args) },
        close() {
          shouldReconnect = false
          innerStore!.close()
          innerStore = null // Error if we get subsequent requests
          setSingle(status, {connected: false})
          // ... And stop reconnecting.
        }
      }
      resolve(s)
    }, reject)
  })

  return [status, ready]
}

export default reconnector