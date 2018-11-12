import * as I from './types/interfaces'

import singleStore from './stores/singlemem'
import kvStore from './stores/kvmem'
import prozessStore from './stores/prozessops'
import lmdbStore from './stores/lmdb'
import remoteStore from './stores/tcpclient'
import augment from './augment'
import {inspect} from 'util'
import {reconnecter} from 'prozess-client'
import server from './net/tcpserver'
import router, {ALL} from './stores/router'

// store.fetch('all', null, {}, (err, results) => {
//   console.log('fetch results', results)
// })
// const sub = store.subscribe('allkv', new Set(['content']), {}, (type, txn, v) => {

const testSingle = async () => {
  const store = augment(singleStore())
  const sub = store.subscribe({type: 'single', q: true}, {})

  const results = await sub.next()
  console.log('sub initial', results.value)

  ;(async () => {
    for await (const data of sub) {
      console.log('subscribe data', inspect(data, false, 10, true))
    }
  })()

  const v = await store.mutate('single', {type:'set', data: {x: 10}})
  console.log('mutate run', v)

  const results2 = await store.fetch({type: 'single', q: true})
  console.log('results', results2)
}

const testResultMap = async () => {
  const store = augment(kvStore())
  const sub = store.subscribe({type: 'allkv', q: true}, {})

  const results = await sub.next()
  console.log('sub initial', results.value)

  ;(async () => {
    for await (const data of sub) {
      console.log('subscribe data', inspect(data, false, 10, true))
    }
  })()

  const txn = new Map([['x', {type:'set', data: {x: 10}}]])
  const v = await store.mutate('resultmap', txn)
  console.log('mutate callback')
  console.log(v)

  const r2 = await store.fetch({type: 'kv', q: new Set(['x'])})
  console.log(r2)
}

const testResultMap2 = async () => {
  const store = augment(kvStore())
  const txn = new Map([['x', {type:'set', data: {x: 10}}]])
  const v = await store.mutate('resultmap', txn)
  const r = await store.getOps!({type: 'allkv', q: true}, {[store.storeInfo.sources![0]!]: {from:0, to:100}})
  console.log(r)
}

const testProzess = async () => {
  const store = await prozessStore(9999, 'localhost')

  store.onTxn = (source, from, to, type, txn) => {
    console.log('ontxn', source, from, to, type, txn)
  }
  const txn = new Map([['x', {type:'set', data: {x: 10}}]])
  const v = await store.mutate('resultmap', txn, {[store.storeInfo.sources![0]!]: 0})
  console.log('mutate cb', v)
}

const testLmdb = async () => {
  const client = reconnecter(9999, 'localhost', err => {
    if (err) throw err
  })

  const store = augment(await lmdbStore(client, process.argv[2] || 'testdb'))

  const sub = store.subscribe({type:'kv', q:new Set(['x', 'q', 'y'])}, {})
  ;(async () => {
    for await (const data of sub) {
      console.log('subscribe data', inspect(data, false, 10, true))
    }
  })()

  // store.onTxn = (source, from, to, type, txn) => {
  //   console.log('ontxn', source, from, to, type, txn)
  // }
  const txn = new Map([['a', {type:'inc', data: 10}]])
  // const txn = new Map([['x', {type:'set', data: {ddd: (Math.random() * 100)|0}}]])
  // const txn = new Map([['q', {type:'set', data: (Math.random() * 100)|0}]])
  console.log('source', store.storeInfo.sources)
  const v = await store.mutate('resultmap', txn, {[store.storeInfo.sources![0]!]: -1})
  console.log('mutate cb', v)

  const results = await store.fetch({type:'allkv', q: true})
  console.log('fetch results', results)

  // store.close()
}

const testNet = async () => {
  const localStore = augment(kvStore())
  server(localStore).listen(3334)
  console.log('listening on 3334')

  const store = await remoteStore(3334, 'localhost')
  const results = await store.fetch({type: 'kv', q:new Set(['x'])})
  console.log(results)
}

const setSingle = (k: I.Key, v: any) => new Map([[k, {type:'set', data: v}]])

const testRouter = async () => {
  const a = augment(kvStore(new Map([['x', 'yo']])))
  const b = augment(kvStore())

  const store = router()
  store.mount(a, 'a/', ALL, '', true)
  store.mount(b, 'b/', ALL, '', true)

  const sub = store.subscribe({type: 'kv', q:new Set(['a/x', 'b/y'])}, {})
  // const sub = a.subscribe({type: 'kv', q:new Set(['x'])}, {})
  console.log('initial', (await sub.next()).value)
  ;(async () => {
    for await (const data of sub) {
      console.log('subscribe data', inspect(data, false, 10, true))
    }
  })()

  // const txn = new Map([['x', {type:'set', data: {x: 10}}]])
  const v = await a.mutate('resultmap', setSingle('x', 'hi'), {[a.storeInfo.sources![0]!]: 0})
}

process.on('unhandledRejection', err => {
  throw err
})

// testResultMap()
// testSingle()
// testProzess()
// testLmdb()
testRouter()
// testNet()