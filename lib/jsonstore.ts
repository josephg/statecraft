import * as fs from 'fs'
import chokidar = require('chokidar')
import * as I from '../common/interfaces'
import fieldType from '../common/fieldops'
import SubGroup from './subgroup'

const fileStore = (filename: string, sourceIn?: string): I.SCSource => {
  const source: string = sourceIn || filename
  
  // Try and load the file.
  let strcontent: string
  let data: object
  let state: 'ok' | 'error'
  let version: number

  let subscriptions: SubGroup | null = null

  const mutateCallbacks: ((err?: Error, result?: I.FullVersion) => void)[] = []

  const onchange = () => {
    console.log('file changed to', data)
    mutateCallbacks.forEach(cb => cb(undefined, {[source]: version}))
    mutateCallbacks.length = 0
    subscriptions!.onOp(source, version, 'resultmap', new Map([['content', {type: 'set', data}]]))
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
      const newversion = fs.statSync(filename).mtime.getTime()
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
          version = version + 1
        } else {
          version = newversion
        }
        onchange()
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
      version = Date.now()
      onchange()
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

  let api: I.SCSource = {
    capabilities: {},
    fetch(qtype, query, opts, callback) {
      // TODO: support kv as well, and return the data through .content.
      let results: any
      switch (qtype) {
        case "content": results = data; break
        case "allkv": results = new Map([['content', data]]); break
        default: return callback(Error(`Invalid query type ${qtype} to json store`))
      }

      callback(undefined, {
        results,
        queryRun: query,
        versions: {[source]: {from:version, to:Date.now()}},
      })
    },

    getOps(qtype, query, versions, callback) {
      // const vs = versions[source]
      // if (vs == null || vs[0] === vs[1]) return callback(null, {ops: [], versions: {}})

      // There aren't actually any operations available.
      return callback(Error('Requested range too old'))
    },

    subscribe(qtype, query, opts, listener): I.Subscription {
      return subscriptions!.create(qtype, query, opts, listener)
    },

    mutate(type, txn, versions, opts, callback) {
      // We'll ignore anything the transaction tries to edit outside of .content.
      const expectv = versions[source]
      if (expectv != null && expectv < version) return callback(Error('Requested version too old'))

      const op = type === 'content' ? <I.Op>txn : (<I.KVTxn>txn).get('content')
      if (op) data = fieldType.apply(data, op)
      console.log('fs.writefilesync')
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
  subscriptions = new SubGroup({}, api)
  tryReadFile(true)

  return api
}

export default fileStore

if (require.main === module) {
  const store = fileStore("testconfig.json")
  // store.fetch('all', null, {}, (err, results) => {
  //   console.log('fetch results', results)
  //   store.mutate(new Map([['content', {type:'set', data: {x: 10}}]]), {}, {}, (err, v) => {
  //     console.log('mutate callback')
  //     console.log(err, v)
  //   })
  // })
  // const sub = store.subscribe('allkv', new Set(['content']), {}, (type, txn, v) => {
  const sub = store.subscribe('allkv', true, {}, (type, txn, v) => {
  // const sub = store.subscribe('content', true, {}, (type, txn, v) => {
    console.log('listener', type, v, txn)
  })
  sub.cursorNext({}, (err, results) => {
    console.log('cursor next', err, results)
  })
}


