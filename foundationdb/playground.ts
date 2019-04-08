import {I} from '@statecraft/core'
import fdbStore from './fdb'
import {Console} from 'console'
import * as fdb from 'foundationdb'

fdb.setAPIVersion(600)

process.on('unhandledRejection', err => {
  console.error(err != null ? (err as any).stack : 'error')
  process.exit(1)
})

global.console = new (Console as any)({
  stdout: process.stdout,
  stderr: process.stderr,
  inspectOptions: {depth: null}
})

const testFDB = async () => {
  const fdbConn = fdb.openSync().at('temp-playground') // TODO: Directory layer stuff.
  const store = await fdbStore(fdbConn)

  const sub = store.subscribe({type:I.QueryType.KV, q:new Set(['x', 'q', 'y'])}, {})
  ;(async () => {
    for await (const data of sub) {
      console.log('subscribe data', data)
    }
  })()

  const txn = new Map([['a', {type:'inc', data: 10}]])
  // const txn = new Map([['x', {type:'set', data: {ddd: (Math.random() * 100)|0}}]])
  // const txn = new Map([['q', {type:'set', data: (Math.random() * 100)|0}]])
  console.log('source', store.storeInfo.sources)
  const v = await store.mutate(I.ResultType.KV, txn)
  console.log('mutate cb', v)

  const results = await store.fetch({type:I.QueryType.AllKV, q: true})
  console.log('fetch results', results)

  store.close()
}

testFDB()
