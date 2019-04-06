// This is a playground of sorts to manually test different bits of code.
// Ideally with a full test suite this wouldn't be needed - but I'm
// (intentionally) not there yet. And in the meantime its useful to exercise
// APIs and code.

// The code here should eventually make its way into a test suite.

import * as I from './interfaces'

import singleStore from './stores/singlemem'
import kvStore from './stores/kvmem'
import poll from './stores/poll'
import mapStore from './stores/map'
import {inspect} from 'util'
import router, {ALL} from './stores/router'
import sel from './sel'
import doTxn, {txnSubscribe} from './transaction'
import {V64} from './version'

import subValues from './subvalues'
import {Console} from 'console'
import { setKV } from './kv'

const ins = (x: any) => inspect(x, {depth: null, colors: true})

// store.fetch('all', null, {}, (err, results) => {
//   console.log('fetch results', results)
// })
// const sub = store.subscribe('allkv', new Set(['content']), {}, (type, txn, v) => {

const testSingle = async () => {
  const store = singleStore(null)
  const sub = store.subscribe({type: I.QueryType.Single, q: true}, {})

  const results = await sub.next()
  console.log('sub initial', results.value)

  ;(async () => {
    for await (const data of sub) {
      console.log('subscribe data', inspect(data, false, 10, true))
    }
  })()

  const v = await store.mutate(I.ResultType.Single, {type:'set', data: {x: 10}})
  console.log('mutate run', v)

  const results2 = await store.fetch({type: I.QueryType.Single, q: true})
  console.log('results', results2)
}

const testResultMap = async () => {
  const store = await kvStore()
  const sub = store.subscribe({type: I.QueryType.AllKV, q: true}, {})

  const results = await sub.next()
  console.log('sub initial', results.value)

  ;(async () => {
    for await (const data of sub) {
      console.log('subscribe data', inspect(data, false, 10, true))
    }
  })()

  const txn = new Map([['x', {type:'set', data: {x: 10}}]])
  const v = await store.mutate(I.ResultType.KV, txn)
  console.log('mutate callback')
  console.log(v)

  const r2 = await store.fetch({type: I.QueryType.KV, q: new Set(['x'])})
  console.log(r2)
}

const testResultMap2 = async () => {
  const store = await kvStore()
  const txn = new Map([['x', {type:'set', data: {x: 10}}]])
  const v = await store.mutate(I.ResultType.KV, txn)
  const r = await store.getOps!({type: I.QueryType.AllKV, q: true}, [{from:new Uint8Array(), to:new Uint8Array()}])
  console.log(r)
}

const toSel = (k: I.Key, isAfter: boolean = false, offset: number = 0) => ({k, isAfter, offset})
const testRange = async () => {
  const store = await kvStore()
  const txn = new Map<I.Key, I.Op<any>>([
    // ['a', {type:'set', data: 0}],
    // ['b', {type:'set', data: 1}],
    // ['c', {type:'set', data: 2}],
    // ['d', {type:'set', data: 3}],
    // ['e', {type:'set', data: 4}],
  ])
  await store.mutate(I.ResultType.KV, txn)

  // When testing, check the invariant that if you send back the queryRun, you
  // should get the same result set.
  const q: I.Query = {
    type: I.QueryType.Range,
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
    for await (const data of subValues(I.ResultType.Range, sub)) {
      console.log('data', data)
    }
  })()
  // console.log('first', ins((await sub.next()).value))
  // ;(async () => {
  //   for await (const data of sub) {
  //     console.log('got sub data', ins(data.txns))
  //   }
  // })()

  // await store.mutate(I.ResultType.KV, new Map([['c', {type: 'inc', data: 10}]]))
  await store.mutate(I.ResultType.KV, new Map([['c', {type: 'set', data: 10}]]))
}


const setSingle = <Val>(k: I.Key, v: Val): I.KVTxn<Val> => new Map([[k, {type:'set', data: v}]])

const testRouter = async () => {
  const a = await kvStore(new Map([['backa/x', 'yo']]))
  const b = await kvStore<string>()

  const store = router<string>()
  store.mount(a, 'a/', ALL, 'backa/', true)
  store.mount(b, 'b/', ALL, '', true)

  const sub = store.subscribe({type: I.QueryType.KV, q:new Set(['a/x', 'b/y'])}, {})

  // const sub = a.subscribe({type: I.QueryType.KV, q:new Set(['x'])}, {})
  console.log('initial', (await sub.next()).value)
  ;(async () => {
    for await (const data of sub) {
      console.log('subscribe data', inspect(data, false, 10, true))
    }
  })()

  // const txn = new Map([['x', {type:'set', data: {x: 10}}]])
  const v = await a.mutate(I.ResultType.KV, setSingle('x', 'hi'), [V64(0)])
}

const testRouterRange = async () => {
  const a = await kvStore(new Map([['ab/x', 'a x'], ['ab/y', 'a y']]))
  const c = await kvStore(new Map([['x', 'c x'], ['y', 'c y']]))

  const store = router()
  store.mount(a, 'a/', ALL, 'ab/', true)
  store.mount(c, 'c/', ALL, '', true)

  const q = {type: I.QueryType.StaticRange, q:[
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
  const v = await a.mutate(I.ResultType.KV, setSingle('y', 'hi'), [V64(0)])
}

const testPoll = async () => {
  const store = await poll(() => Promise.resolve(Date.now()))
  
  const sub = store.subscribe({type: I.QueryType.Single, q: true}, {})
  console.log('initial', (await sub.next()).value)
  ;(async () => {
    for await (const data of sub) {
      console.log('subscribe data', inspect(data, false, 10, true))
    }
  })()
}



const txnSub = async () => {
  // const client = await connectProzess()
  const store = await kvStore<string | number>()
  await store.mutate(I.ResultType.KV, setSingle('ptr', 'x'))
  await store.mutate(I.ResultType.KV, setSingle('x', 0))
  await store.mutate(I.ResultType.KV, setSingle('y', 1))

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

    store.mutate(I.ResultType.KV, mut)

  }, 1000)
}

const reproMapRouterBug = async () => {
  const a = await kvStore(new Map([['backend/x', 'a x'], ['ab/y', 'a y']]))
  const m = mapStore(a, s => 'map ' + s)

  const r = router()
  r.mount(m, 'f mapped/', ALL, 'backend/', true)
  r.mount(a, 'f raw/', ALL, 'backend/', true)

  ;(async () => {
    const sub = r.subscribe({type: I.QueryType.StaticRange, q: [{low: sel('f'), high: sel('f\xff')}]})
    // const sub = r.subscribe({type: I.QueryType.KV, q: new Set(['f mapped/x', 'f raw/x'])})
    for await (const cu of sub) {
      console.log('cu', cu)
    }
  })()

  await new Promise(resolve => setTimeout(resolve, 200))
  await setKV(a, 'backend/x', 'a x 2')
  await setKV(a, 'backend/x', 'a x 3')

  // const store = router()
  // store.mount(a, 'a/', ALL, 'ab/', true)

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
// contentful()

reproMapRouterBug()