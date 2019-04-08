import {I, stores} from '@statecraft/core'
import lmdbStore from './lmdb'
import {Console} from 'console'

const {opmem} = stores


process.on('unhandledRejection', err => {
  console.error(err != null ? (err as any).stack : 'error')
  process.exit(1)
})

global.console = new (Console as any)({
  stdout: process.stdout,
  stderr: process.stderr,
  inspectOptions: {depth: null}
})



const testLmdb = async () => {
  const ops = opmem()
  // const client = await connectProzess()

  const store = await lmdbStore(ops, process.argv[2] || 'testdb')

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
  const v = await store.mutate(I.ResultType.KV, txn, [new Uint8Array()])
  console.log('mutate cb', v)

  const results = await store.fetch({type:I.QueryType.AllKV, q: true})
  console.log('fetch results', results)

  // store.close()
}

testLmdb()
