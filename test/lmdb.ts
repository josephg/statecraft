import createMock from './prozess-mock'
import * as I from '../lib/types/interfaces'

/*
process.on('unhandledRejection', err => { throw err })

;(async () => {
  const client = createMock()
  const base = await client.getVersion()
  console.log('v', base)

  console.log('op1', await client.send("hi", {
    conflictKeys: ['a']
  }))
  console.log('op2', await client.send("hi", {
    conflictKeys: ['a'],
    targetVersion: 1 + base, // should conflict with a 1, pass with a 2.
  }))
  console.log('op3', await client.send("hi"))

  console.log('v', await client.getVersion())
})()*/

import 'mocha'
import lmdb from '../lib/stores/lmdb'
import augment from '../lib/augment'
import runTests from './common'
import fs = require('fs')

const rmdir = (path: string) => {
  //console.log('rmdir path', path)
  require('child_process').exec('rm -r ' + path)
}

const pathOfDb = new Map
let _dbid = 1

process.on('exit', function() {
  for (let p of pathOfDb.values()) {
    rmdir(p)
  }
})

const create = () => {
  let path: string
  do {
    // path = __dirname + '/_test' + _dbid++
    path = '_test' + _dbid++
  } while (fs.existsSync(path))

  const store = augment(lmdb(createMock(), path))
  pathOfDb.set(store, path)
  return store
}

const teardown = (store: I.Store) => { // teardown. Nuke it.
  const path = pathOfDb.get(store)
  rmdir(path)
  pathOfDb.delete(store)
}

describe('lmdb on prozess', () => {
  runTests(
    () => Promise.resolve(create()),
    teardown
  )
})