// This is a utility store to populate a statecraft store with content from contentful
import * as I from '../interfaces'
import {createClient, CreateClientParams, SyncCollection, Entry, Sys} from 'contentful'
import { V64 } from '../version';

const stripLocale = (locale: string, obj: any | null) => (
  obj == null ? null : obj[locale]
)

const flattenFields = (locale: string, obj: Entry<any>): any => {
  const data: any = {}

  for (const k in obj.fields) {
    const field = stripLocale(locale, obj.fields[k])
    // console.log('field', field)
    data[k] = field == null ? null
      // : typeof field === 'object' ? flattenFields(locale, field)
      : typeof field === 'object' && !Array.isArray(field) ? field.sys.id
      : field
  }

  ;(['createdAt', 'updatedAt'] as (keyof Sys)[]).forEach(k => {
    if (obj.sys[k] != null) data[k] = obj.sys[k]
  })

  return data
}

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

        const locales = await client.getLocales()
        const defaultLocale = locales.items.find(l => l.default)!.code
        // console.log('locales', locales.items)
        // console.log('default locale', defaultLocale)

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
            console.log('nst', nextSyncToken, 'entries', entries.map(e => e.sys.id))
            
            const txn = new Map<I.Key, I.Op<any>>()
            entries.forEach(e => {
              const fields = flattenFields(defaultLocale, e)
              // console.log('entry', e.sys.contentType, fields)
              txn.set(e.sys.contentType.sys.id + '/' + e.sys.id, {type: 'set', data: fields})
            })

            store.onTxn!(source, V64(version), V64(++version), 'kv', txn, null, {})
          }

          await new Promise(resolve => setTimeout(resolve, 2000))
          process.stdout.write('.')
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