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
import {V64, vEq, vInc} from '../version'

const capabilities = {
  queryTypes: new Set<I.QueryType>(['single']),
  mutationTypes: new Set<I.ResultType>(['single']),
  ops: <I.OpsSupport>'none',
}

const fileStore = (filename: string, sourceIn?: string): I.SimpleStore => {
  const source: I.Source = sourceIn || filename

  // Try and load the file.
  let strcontent: string
  let data: object
  let state: 'ok' | 'error'
  let version: I.Version

  const resolveFns: ((v: I.FullVersion) => void)[] = []

  function onchange(v: I.Version) {
    console.log('file changed to', data, v)
    const oldVersion = version
    version = v
    resolveFns.forEach(cb => cb({[source]: version}))
    resolveFns.length = 0
    store.onTxn && store.onTxn(source, oldVersion, version, 'single', {type: 'set', data}, data, {})
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
      try {
        // console.log('xxxx newcontent', newcontent)
        if (newcontent === strcontent && vEq(newversion, version)) return false

        if (newcontent !== strcontent) {
          strcontent = newcontent
          data = JSON.parse(newcontent)
        }
        state = 'ok'
        // mtimeMs is also available on node 8.
        if (newversion <= version) {
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

  const watcher = chokidar.watch(filename).on('change', (path, stats) => {
    console.log('watch fired', stats)
    tryReadFile(false)
  })

  // watcher.on('error', err => console.error('Watcher error', err))

  const store: I.SimpleStore = {
    storeInfo: {
      capabilities,
      sources: [source],
    },
    fetch(query, opts) {
      if (query.type !== 'single') return Promise.reject(new err.UnsupportedTypeError(`Unsupported query type ${query.type} to json store`))

      return Promise.resolve({
        results: data,
        queryRun: query,
        versions: {[source]: {from:version, to:V64(Date.now())}},
      })
    },

    mutate(type, txn, versions, opts = {}) {
      if (type !== 'single') return Promise.reject(new err.UnsupportedTypeError())
      const op = txn as I.Op

      const expectv = versions && versions[source]
      if (expectv != null && expectv < version) return Promise.reject(new err.VersionTooOldError())

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

  return store
}

export default fileStore
