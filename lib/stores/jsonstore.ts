import * as I from '../types/interfaces'
import fieldType from '../types/fieldops'
import * as err from '../err'

import * as fs from 'fs'
import chokidar = require('chokidar')


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

  const mutateCallbacks: I.Callback<I.FullVersion>[] = []

  function onchange(v: I.Version) {
    console.log('file changed to', data, v)
    const oldVersion = version
    version = v
    mutateCallbacks.forEach(cb => cb(null, {[source]: version}))
    mutateCallbacks.length = 0
    store.onTxn && store.onTxn(source, oldVersion, version, 'single', {type: 'set', data})
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
      let newversion = fs.statSync(filename).mtime.getTime()
      try {
        // console.log('xxxx newcontent', newcontent)
        if (newcontent === strcontent && newversion === version) return false

        if (newcontent !== strcontent) {
          strcontent = newcontent
          data = JSON.parse(newcontent)
        }
        state = 'ok'
        // mtimeMs is also available on node 8.
        if (newversion <= version) {
          console.warn('WARNING: mtime not increased. Forcing version bump.')
          newversion = version + 1
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
      onchange(Date.now())
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
    capabilities,
    fetch(qtype, query, opts, callback) {
      if (qtype !== 'single') return callback(new err.UnsupportedTypeError(`Unsupported query type ${qtype} to json store`))

      callback(undefined, {
        results: data,
        queryRun: query,
        versions: {[source]: {from:version, to:Date.now()}},
      })
    },

    mutate(type, op: I.Op, versions, opts, callback) {
      if (type !== 'single') return callback(new err.UnsupportedTypeError())

      const expectv = versions[source]
      if (expectv != null && expectv < version) return callback(new err.VersionTooOldError())

      if (op) data = fieldType.apply(data, op)
      // console.log('fs.writefilesync')
      mutateCallbacks.push(callback)
      fs.writeFile(filename, JSON.stringify(data), (err) => {
        if (err) {
          callback(err)
          // Remove the callback from the list
          const index = mutateCallbacks.indexOf(callback)
          if (index != -1) {
            mutateCallbacks[index] = mutateCallbacks[mutateCallbacks.length - 1]
            mutateCallbacks.length--
          }
        }
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
