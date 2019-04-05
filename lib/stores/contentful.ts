// This is a utility store to populate a statecraft store with content from contentful
import * as I from '../interfaces'
import {createClient, CreateClientParams, SyncCollection, Entry, Sys} from 'contentful'
import { V64, vEq, vCmp, vInc } from '../version';
import { getKV } from '../kv';
import err from '../err'
import makeOpCache from '../opcache'
import SubGroup from '../subgroup'

const CONTENT_TYPE_PREFIX = 'ContentType/'
const stripLocale = (locale: string, obj: any | null) => (
  obj == null ? null : obj[locale]
)

const entryKey = (e: Entry<any>) => e.sys.contentType.sys.id + '/' + e.sys.id

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

const createContentfulStore = (syncState: I.Store<any>, opts: {
  query?: any,
  source?: I.Source,
  // vStore: I.Store<
} & CreateClientParams): I.Store<any> => {
  console.log(opts)
  const client = createClient(opts)
  const source = opts.source || opts.space
  let closed = false

  const opCache = makeOpCache<any>()
  const subGroup = new SubGroup({
    getOps: opCache.getOps, 
    async start(fv) {
      let version = V64(0)
      ;(async () => {
        let nextSyncToken = null
        let initial = true

        const state: {vStr: string, syncToken: string} | null = await getKV(syncState, 'state')

        if (state != null && fv != null && fv[0] != null) {
          const current_version = Buffer.from(state.vStr, 'base64')
          if (vCmp(fv[0]!, current_version) <= 0) {
            version = current_version
            initial = false
            nextSyncToken = state.syncToken
          }
        }
        
        if (initial) console.log('Initializing from raw state')
        else console.log('initialized from store at version', version)

        // const contentTypes = await client.getContentTypes()
        // const typeForId: {[k: string]: string} = {}
        // contentTypes.items.forEach(({sys, name}) => {
        //   console.log(sys)
        //   typeForId[sys.id] = name
        // })
        // console.log('ct', typeForId)
        // return

        // Could put this in the state object ... ??
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

          if (result.nextSyncToken !== nextSyncToken) {
            nextSyncToken = result.nextSyncToken
            const {entries, assets, deletedEntries} = result

            console.log('assets', assets)
          
            console.log('nst', nextSyncToken, 'entries', entries.map(e => e.sys.id))
            
            const nextVersion = vInc(version)
            const txn = new Map<I.Key, I.Op<any>>()
            const syncTxn = new Map<I.Key, I.Op<any>>([
              ['state', {type: 'set', data: {vStr: Buffer.from(nextVersion).toString('base64'), syncToken: nextSyncToken}}]
            ])

            entries.forEach(e => {
              const fields = flattenFields(defaultLocale, e)
              // console.log('entry', e.sys.contentType, fields)
              txn.set(entryKey(e), {type: 'set', data: fields})
              syncTxn.set(CONTENT_TYPE_PREFIX + e.sys.id, {type: 'set', data: e.sys.contentType.sys.id})
            })
            
            if (deletedEntries.length) {
              const types = (await syncState.fetch({type: I.QueryType.KV, q: new Set(deletedEntries.map(e => CONTENT_TYPE_PREFIX + e.sys.id))})).results
              
              for (const e of deletedEntries) {
                const contentType = types.get(CONTENT_TYPE_PREFIX + e.sys.id)
                if (contentType == null) console.warn('Missing entity type in CF state store')
                else {
                  console.log('del', e, contentType)
                  txn.set(contentType + '/' + e.sys.id, {type: 'rm'})
                  syncTxn.set(CONTENT_TYPE_PREFIX + e.sys.id, {type: 'rm'})
                }
              }
            }

            // console.log('txn', txn)
            // console.log('synctxn', syncTxn)

            opCache.onOp(0, version, nextVersion, I.ResultType.KV, txn, {})
            subGroup.onOp(0, version, [{txn, meta: {}, versions: [nextVersion]}])
            
            // Ok, now update our sync state. Note that this happens *after* we
            // notify upstream. Ideally we would wait until the txn was
            // ingested before updating our sync state
            await syncState.mutate(I.ResultType.KV, syncTxn)
            version = nextVersion
          }

          await new Promise(resolve => setTimeout(resolve, 2000))
          process.stdout.write('.')
        }
      })()

      // We have a problem that versions are opaque strings.
      return [version]
    }
  })

  const store: I.Store<any> = {
    storeInfo: {
      uid: `cf(${source})`, // Could expose the contentful space ID here, but I don't wnat to leak it.
      sources: [source],
      capabilities: {
        // TODO: Add support for mutation and querying through these APIs.
        queryTypes: 0,
        mutationTypes: 0,
      }
    },

    getOps: opCache.getOps,
    subscribe: subGroup.create.bind(subGroup),

    fetch() {
      throw new err.UnsupportedTypeError()
    },

    mutate() {
      throw new Error('Not implemented')
    },

    close() {}
  }
  return store
}

export default createContentfulStore