import {I, err, setSingle, stores} from '@statecraft/core'
import {TinyReader, TinyWriter} from './tinystream'
import * as N from './netmessages'
import createStore, {NetStore, ClientOpts} from './client'
// import singleMem, {setSingle} from './singlemem'
import resolvable from '@josephg/resolvable'

const {singlemem} = stores
const wait = (timeout: number) => new Promise(resolve => setTimeout(resolve, timeout))

// Connection states:
// - connecting
// - connected
// - waiting
// - stopped
type Status = string

/**
 * Create a new client reconnector.
 *
 * This is the main entrypoint for clients to connect to remote stores, and
 * automatically reconnect when they are disconnected.
 *
 * @param connect A function which creates the network streams. This function
 * will be called to connect initially, and then which each reconnect. Most
 * users should use `connectToSocket` or `connectToWS`. Eg `() => net.connectToWS(wsurl)`
 *
 * @returns a 3-tuple with 3 values:
 *
 * - A single value store with connection status information. This will have a
 *   string with values `'waiting'`, `'connecting'`, `'connected'` and
 *   `'stopped'`.
 * - A promise to the store itself. The promise will resolve once the store
 *   connects for the first time.
 * - A promise to an exception which will throw if the connected store's UID
 *   changes. If the server's architecture changes, its UID will change and
 *   we can no longer re-establish our subscriptions because any version
 *   numbers are no longer necessarily valid. On the web You should probably
 *   reload the page when this happens.
 */
const reconnector = <Val>(connect: (() => Promise<[TinyReader<N.SCMsg>, TinyWriter<N.CSMsg>]>)): [I.Store<Status>, Promise<I.Store<Val>>, Promise<void>] => {
  // This is a tiny store that the client can use to track & display whether
  // or not we're currently connected. Ite tempting to make a metastore be a
  // default feature.
  const status = singlemem('waiting')
  let innerStore: NetStore<Val> | null = null
  let shouldReconnect = true
  const uidChanged = resolvable()

  // const initialStoreP = 
  // initialStoreP.then(store => { innerStore = store; })

  const ready: Promise<I.Store<Val>> = new Promise((resolve, reject) => {
    const opts: ClientOpts<Val> = {
      preserveState: true,
      onClose() {
        // We don't clear innerStore yet - all requests will still go there
        // until we change the guard.
        setSingle(status, 'waiting')

        // This is pretty rough.
        ;(async () => {
          while (shouldReconnect) {
            console.log('... trying to reconnect ...')

            let r: TinyReader<N.SCMsg>, w: TinyWriter<N.CSMsg>
            let netConnected = false
            try {
              setSingle(status, 'connecting')
              ;[r, w] = await connect()
              netConnected = true
            } catch (e) {
              console.warn('Reconnection failed', e.message)
            }

            if (netConnected) try {
              console.log('createStore')
              await createStore(r!, w!, {
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
              // TODO: Consider calling reject instead of resolve here - so the
              // error makes an exception by default.
              if (e instanceof err.StoreChangedError) {
                console.log('uid changed')
                w!.close()
                uidChanged.reject(e)
                break
              } else throw e
            }

            setSingle(status, 'waiting')
            await wait(5000)
            console.log('done waiting')
          }
        })()
      },
    }


    setSingle(status, 'connecting')
    connect()
    .then(([r, w]) => createStore(r, w, opts))
    .then(initialStore => {
      innerStore = initialStore
      setSingle(status, 'connected')

      // This is basically a proxy straight to innerStore.
      const s: I.Store<Val> = {
        storeInfo: initialStore.storeInfo,
        fetch(...args) { return innerStore!.fetch(...args) },
        getOps(...args) { return innerStore!.getOps(...args) },
        mutate(...args) { return innerStore!.mutate(...args) },
        subscribe(...args) { return innerStore!.subscribe(...args) },
        close() {
          shouldReconnect = false
          innerStore!.close()
          innerStore = null // Error if we get subsequent requests
          setSingle(status, 'closed')
          // ... And stop reconnecting.
        }
      }
      resolve(s)
    }, reject)
  })

  return [status, ready, uidChanged]
}

export default reconnector