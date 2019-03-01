// This is a playground of sorts to manually test different bits of code.
// Ideally with a full test suite this wouldn't be needed - but I'm
// (intentionally) not there yet. And in the meantime its useful to exercise
// APIs and code.

// The code here should eventually make its way into a test suite.


import assert from 'assert'

import * as I from './interfaces'

import singleStore from './stores/singlemem'
import kvStore from './stores/kvmem'
import prozessOps from './stores/prozessops'
import lmdbStore from './stores/lmdb'
import remoteStore from './stores/tcpclient'
import poll from './stores/poll'
import augment from './augment'
import {inspect} from 'util'
import {PClient, reconnecter} from 'prozess-client'
import server from './net/tcpserver'
import router, {ALL} from './stores/router'
import sel from './sel'
import doTxn, {txnSubscribe} from './transaction'
import {V64} from './version'
import * as textType from 'ot-text-unicode'

import * as fdb from 'foundationdb'
import fdbStore from './stores/fdb'
import createContentful from './stores/contentful';
import { readFileSync } from 'fs';
import subValues from './subvalues';
import {Console} from 'console'
fdb.setAPIVersion(600)

const ins = (x: any) => inspect(x, {depth: null, colors: true})

// store.fetch('all', null, {}, (err, results) => {
//   console.log('fetch results', results)
// })
// const sub = store.subscribe('allkv', new Set(['content']), {}, (type, txn, v) => {

const testSingle = async () => {
  const store = augment(singleStore(null))
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
  const store = augment(await kvStore())
  const sub = store.subscribe({type: 'allkv', q: true}, {})

  const results = await sub.next()
  console.log('sub initial', results.value)

  ;(async () => {
    for await (const data of sub) {
      console.log('subscribe data', inspect(data, false, 10, true))
    }
  })()

  const txn = new Map([['x', {type:'set', data: {x: 10}}]])
  const v = await store.mutate('kv', txn)
  console.log('mutate callback')
  console.log(v)

  const r2 = await store.fetch({type: 'kv', q: new Set(['x'])})
  console.log(r2)
}

const testResultMap2 = async () => {
  const store = augment(await kvStore())
  const txn = new Map([['x', {type:'set', data: {x: 10}}]])
  const v = await store.mutate('kv', txn)
  const r = await store.getOps!({type: 'allkv', q: true}, {[store.storeInfo.sources![0]!]: {from:new Uint8Array(), to:new Uint8Array()}})
  console.log(r)
}

const toSel = (k: I.Key, isAfter: boolean = false, offset: number = 0) => ({k, isAfter, offset})
const testRange = async () => {
  const store = augment(await kvStore())
  const txn = new Map<I.Key, I.Op<any>>([
    // ['a', {type:'set', data: 0}],
    // ['b', {type:'set', data: 1}],
    // ['c', {type:'set', data: 2}],
    // ['d', {type:'set', data: 3}],
    // ['e', {type:'set', data: 4}],
  ])
  await store.mutate('kv', txn)

  // When testing, check the invariant that if you send back the queryRun, you
  // should get the same result set.
  const q: I.Query = {
    type: 'range',
    q: [{
      low: toSel('a', true),
      // to: toSel('x'),
      high: {k: 'x', isAfter: false, offset: -1},
      reverse: false,
      limit: 2,
    }]
  }
  const f = await store.fetch(q)

  console.log('fetch returned', ins(f))

  const sub = store.subscribe(q, {supportedTypes: new Set(['set', 'rm'])})

  ;(async () => {
    for await (const data of subValues('range', sub)) {
      console.log('data', data)
    }
  })()
  // console.log('first', ins((await sub.next()).value))
  // ;(async () => {
  //   for await (const data of sub) {
  //     console.log('got sub data', ins(data.txns))
  //   }
  // })()

  // await store.mutate('kv', new Map([['c', {type: 'inc', data: 10}]]))
  await store.mutate('kv', new Map([['c', {type: 'set', data: 10}]]))
}

const connectProzess = (): Promise<PClient> => new Promise((resolve, reject) => {
  const client = reconnecter(9999, 'localhost', err => {
    if (err) reject(err)
    else resolve(client)
  }) as PClient
})

const testProzess = async () => {
  const client = await connectProzess()
  const store = prozessOps(client)

  store.onTxn = (source, from, to, type, txn) => {
    console.log('ontxn', source, from, to, type, txn)
  }
  const txn = new Map([['x', {type:'set', data: {x: 10}}]])
  const v = await store.mutate('kv', txn, {[store.storeInfo.sources![0]!]: new Uint8Array()})
  console.log('mutate cb', v)
}

const testLmdb = async () => {
  const client = await connectProzess()

  const store = augment(await lmdbStore(prozessOps(client), process.argv[2] || 'testdb'))

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
  const v = await store.mutate('kv', txn, {[store.storeInfo.sources![0]!]: new Uint8Array()})
  console.log('mutate cb', v)

  const results = await store.fetch({type:'allkv', q: true})
  console.log('fetch results', results)

  // store.close()
}

const listen = async () => {
  const localStore = augment(await kvStore())
  server(localStore).listen(3334)
  console.log('listening on 3334')
}

const testNet = async () => {
  await listen()

  const store = await remoteStore(3334, 'localhost')
  const results = await store.fetch({type: 'kv', q:new Set(['x'])})
  console.log(results)
}

const setSingle = <Val>(k: I.Key, v: Val): I.KVTxn<Val> => new Map([[k, {type:'set', data: v}]])

const testRouter = async () => {
  const a = augment(await kvStore(new Map([['x', 'yo']])))
  const b = augment(await kvStore<string>())

  const store = router<string>()
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
  const v = await a.mutate('kv', setSingle('x', 'hi'), {[a.storeInfo.sources![0]!]: V64(0)})
}

const testRouterRange = async () => {
  const a = augment(await kvStore(new Map([['x', 'a x'], ['y', 'a y']])))
  const c = augment(await kvStore(new Map([['x', 'c x'], ['y', 'c y']])))

  const store = router()
  store.mount(a, 'a/', ALL, '', true)
  store.mount(c, 'c/', ALL, '', true)

  const q = {type: 'static range', q:[
    {low: sel('a/x', true), high: sel('z'), reverse: true},
    // {from: sel('c'), to: sel('z')},
  ]} as I.Query

  const r = await store.fetch(q)
  console.log('fetch result', ins(r))

  const sub = store.subscribe(q)
  console.log('initial', (await sub.next()).value)
  ;(async () => {
    for await (const data of sub) {
      console.log('subscribe data', inspect(data, false, 10, true))
    }
  })()
  const v = await a.mutate('kv', setSingle('y', 'hi'), {[a.storeInfo.sources![0]!]: V64(0)})
}

const testPoll = async () => {
  const store = augment(await poll(() => Promise.resolve(Date.now())))
  
  const sub = store.subscribe({type: 'single', q: true}, {})
  console.log('initial', (await sub.next()).value)
  ;(async () => {
    for await (const data of sub) {
      console.log('subscribe data', inspect(data, false, 10, true))
    }
  })()
}


const retryTest = async () => {
  const concurrentWrites = 10

  const client = await connectProzess()
  // const localStore = augment(await lmdbStore(prozessOps(client), process.argv[2] || 'testdb'))
  const localStore = augment(await kvStore<number>())

  // Using net to give it a lil' latency.
  // const s = server(localStore).listen(3334)
  // const store = await remoteStore(3334, 'localhost')

  const store = localStore

  await store.mutate('kv', setSingle('x', 0))
  // await db.set('x', numToBuf(0))

  let txnAttempts = 0
  const sync = await Promise.all(new Array(concurrentWrites).fill(0).map((_, i) => (
    doTxn(store, async txn => {
      const val = await txn.get('x')
      txn.set('x', val+1)
      return txnAttempts++
    })
  )))

  const result = await doTxn(store, txn => txn.get('x'))
  assert.strictEqual(result, concurrentWrites)

  // This doesn't necessarily mean there's an error, but if there weren't
  // more attempts than there were increments, the database is running
  // serially and this test is doing nothing.
  assert(txnAttempts > concurrentWrites)

  console.log('attempts', txnAttempts)
  console.log(sync)

  client.close()
  store.close()
  // s.close()
}

const getOps = async () => {
  const fdbConn = fdb.openSync().at('textdemo') // TODO: Directory layer stuff.
  const backend = await fdbStore<string>(fdbConn)

  // const backend = lmdbStore(
  const store = augment(backend)
  const source = store.storeInfo.sources[0]
  const ops = await store.getOps({type: 'kv', q:new Set(['asdf'])}, {[source]: {from: Buffer.alloc(0), to:  Buffer.alloc(0)}})

  let doc: any = null
  ops.ops.forEach(o => {
    const op = (o.txn as I.KVTxn<string>).get('asdf') as I.SingleOp<string>
    if (op.type === 'set') doc = op.data
    else if (op.type === 'text-unicode') doc = textType.type.apply(doc, op.data)
    console.log({
      version: Array.from(o.versions[source]),
      len: doc.length, op: op.data, meta: o.meta}, doc)
  })

  store.close()
}

const txnSub = async () => {
  // const client = await connectProzess()
  const store = augment(await kvStore<string | number>())
  await store.mutate('kv', setSingle('ptr', 'x'))
  await store.mutate('kv', setSingle('x', 0))
  await store.mutate('kv', setSingle('y', 1))

  const sub = txnSubscribe(store, async txn => {
    const ptr = await txn.get('ptr') as string
    const val = await txn.get(ptr)
    return val
  })

  ;(async () => {
    for await (const v of sub) {
      console.log('v', v)
    }
  })()

  setInterval(async () => {
    let mut: I.KVTxn<string> = new Map

    if (Math.random() < 0.5) {
      const val = Math.random() < 0.5 ? 'x' : 'y'
      console.log('setting ptr to', val)
      mut.set('ptr', {type: 'set', data: val})
    }

    ;['x', 'y'].forEach((k) => {
      if (Math.random() < 0.15) {
        const val = Math.floor(Math.random() * 100)
        console.log('setting', k, 'to', val)
        mut.set(k, {type: 'set', data: val})
      }
    })

    store.mutate('kv', mut)

  }, 1000)
}

const contentful = async () => {
  const keys = JSON.parse(readFileSync('keys.json', 'utf8'))
  const ops = createContentful(await kvStore(), {
    space: keys.space,
    accessToken: keys.contentAPI,

  })

  const store = augment(await kvStore(undefined, {inner: ops}))
  const sub = store.subscribe({type: 'static range', q: [{
    low: sel(''),
    // low: sel('post/'),
    high: sel('post/\xff'),
  }]})
  // for await (const r of sub) {
  //   console.log('results', ins(r))
  // }
  for await (const r of subValues('range', sub)) {
    console.log('results', ins(r))
  }
}

process.on('unhandledRejection', err => {
  console.error(err.stack)
  process.exit(1)
})

global.console = new (Console as any)({
  stdout: process.stdout,
  stderr: process.stderr,
  inspectOptions: {depth: null}
})

// testResultMap()
// testRange()
// testSingle()
// testProzess()
// testLmdb()
// testRouter()
// testRouterRange()
// testNet()
// retryTest()

// listen()
// testPoll()

// getOps()
// txnSub()


// testRange()
contentful()