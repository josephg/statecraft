// This is a simple store that is backed up by a file on disk.
//
// It uses file watchers to keep the data up to date as the file content
// changes.

// It'd be great to make a KV wrap for this which re-exposes it out as a kv
// store. Basically the inverse of onekey.

import * as I from '../interfaces'
import fieldOps from '../types/field'
import err from '../err'

import fs from 'fs'
import chokidar from 'chokidar'
import {V64, vEq, vInc, vCmp} from '../version'
import { bitSet } from '../bit'
import makeOpCache from '../opcache'
import SubGroup from '../subgroup'

const capabilities = {
  queryTypes: bitSet(I.QueryType.Single),
  mutationTypes: bitSet(I.ResultType.Single),
  ops: <I.OpsSupport>'none',
}

const fileStore = <Val>(filename: string, sourceIn?: string): I.Store<Val> => {
  const source: I.Source = sourceIn || filename

  // Try and load the file.
  let strcontent: string
  let data: object
  let state: 'ok' | 'error'
  let version: I.Version

  const resolveFns: ((v: I.FullVersion) => void)[] = []

  const fetch: I.FetchFn<Val> = (query, opts) => {
    if (query.type !== I.QueryType.Single) return Promise.reject(new err.UnsupportedTypeError(`Unsupported query type ${query.type} to json store`))

    return Promise.resolve({
      results: data,
      queryRun: query,
      versions: [{from:version, to:V64(Date.now())}],
    })
  }

  const opcache = makeOpCache<Val>()
  // Set before store is returned.
  let subGroup: SubGroup<Val> | null = null

  function onchange(v: I.Version) {
    console.log('file changed to', data, v)
    const oldVersion = version
    version = v
    resolveFns.forEach(cb => cb([version]))
    resolveFns.length = 0
    const txns: I.TxnWithMeta<Val>[] = [{
      txn: {type: 'set', data},
      meta: {},
      versions: [version],
    }]
    opcache.onOp(0, oldVersion, version, I.ResultType.Single, txns[0].txn, txns[0].meta)
    subGroup!.onOp(0, oldVersion, txns)
  }

  const tryReadFile = (create: boolean) => {
    // Possible cases this function needs to consider:
    // - Spurious fs watch events that don't change the file
    // - More edits happening between calling readFile and stat resulting in
    //   inconsistent reads
    // - Invalid JSON in file
    // - File does not exist (esp on first call)
    if (fs.existsSync(filename)) {
      const newcontent = fs.readFileSync(filename, 'utf8')
      let newversion = V64(fs.statSync(filename).mtime.getTime())
      if (subGroup == null) subGroup = new SubGroup({initialVersion: [newversion], fetch, getOps: opcache.getOps})
      try {
        // console.log('xxxx newcontent', newcontent)
        if (newcontent === strcontent && vEq(newversion, version)) return false

        if (newcontent !== strcontent) {
          strcontent = newcontent
          data = JSON.parse(newcontent)
        }
        state = 'ok'
        // mtimeMs is also available on node 8.
        if (vCmp(newversion, version) <= 0) {
          console.warn('WARNING: mtime not increased. Forcing version bump.')
          newversion = vInc(version)
        }
        onchange(newversion)
        // TODO: Consider re-checking file content at this point, to avoid a
        // race condition.
      } catch (e) {
        console.error('Error reading file', e)
        state = 'error'
      }
    } else if (create) {
      console.log('Creating new file', filename)
      data = {}
      fs.writeFileSync(filename, JSON.stringify(data))
      state = 'ok'
      onchange(V64(Date.now()))
    } else {
      // The file was moved away or deleted.
      state = 'error'
      console.error('File no longer exists. Using last known good config')
    }
  }

  const store: I.Store<Val> = {
    storeInfo: {
      uid: `file(${source})`, // Not putting the filename in here because it could be sensitive
      capabilities,
      sources: [source],
    },
    
    fetch,
    getOps: opcache.getOps,
    subscribe(q, opts) { return subGroup!.create(q, opts) },

    mutate(type, txn, versions, opts = {}) {
      if (type !== I.ResultType.Single) return Promise.reject(new err.UnsupportedTypeError())
      const op = txn as I.Op<Val>

      const expectv = versions && versions[0]
      if (expectv != null && vCmp(expectv, version) < 0) return Promise.reject(new err.VersionTooOldError())

      if (op) data = fieldOps.apply(data, op)
      // console.log('fs.writefilesync')
      return new Promise((resolve, reject) => {
        resolveFns.push(resolve)

        // TODO: Lock around this.
        fs.writeFile(filename, JSON.stringify(data), (err) => {
          if (err) {
            reject(err)
            // Remove the callback from the list
            const index = resolveFns.indexOf(resolve)
            if (index != -1) {
              resolveFns[index] = resolveFns[resolveFns.length - 1]
              resolveFns.length--
            }
          }
        })
      })
    },

    close() {
      watcher.close()
    }
  }

  tryReadFile(true)

  const watcher = chokidar.watch(filename).on('change', (path, stats) => {
    // console.log('watch fired', stats)
    tryReadFile(false)
  })

  // watcher.on('error', err => console.error('Watcher error', err))

  return store
}

export default fileStore
