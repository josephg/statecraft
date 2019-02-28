// This is a utility store to populate a statecraft store with content from contentful
import * as I from '../interfaces'
import {createClient, CreateClientParams, SyncCollection} from 'contentful'
import { V64 } from '../version';

const createContentfulStore = (opts: {
  query?: any,
  source?: I.Source,
  // vStore: I.Store<
} & CreateClientParams): I.OpStore<any> => {
  console.log(opts)
  const client = createClient(opts)
  const source = opts.source || opts.space
  let closed = false

  // TODO: Fix me.
  let version = 0

  const store: I.OpStore<any> = {
    storeInfo: {
      sources: [source],
      capabilities: {
        // TODO: Add support for mutation and querying through these APIs.
        queryTypes: new Set(),
        mutationTypes: new Set(),
      }
    },

    mutate() {
      throw new Error('Not implemented')
    },

    async start(v) {
      ;(async () => {
        let nextSyncToken = null
        let initial = v == null

        // const contentTypes = await client.getContentTypes()
        // const typeForId: {[k: string]: string} = {}
        // contentTypes.items.forEach(({sys, name}) => {
        //   console.log(sys)
        //   typeForId[sys.id] = name
        // })
        // console.log('ct', typeForId)
        // return

        while (!closed) {
          const result: SyncCollection = await client.sync({
            ...opts.query,
            initial,
            nextSyncToken,
          })
          initial = false
          const {entries, assets} = result
          nextSyncToken = result.nextSyncToken

          
          if (entries.length) {
            console.log('nst', nextSyncToken, 'entries', entries)
            
            const txn = new Map<I.Key, I.Op<any>>()
            entries.forEach(e => {
              console.log('entry', e.sys.contentType)
              txn.set(e.sys.contentType.sys.id + '/' + e.sys.id, {type: 'set', data: e.fields})
            })

            store.onTxn!(source, V64(version), V64(++version), 'kv', txn, null, {})
          }

          await new Promise(resolve => setTimeout(resolve, 2000))
        }
      })()

      // We have a problem that versions are opaque strings.
      return {[source]: V64(version)}
    },

    close() {}
  }
  return store
}

export default createContentfulStore