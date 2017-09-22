import singleStore from './stores/singlemem'
import kvStore from './stores/kvmem'
import augment from './augment'

// store.fetch('all', null, {}, (err, results) => {
//   console.log('fetch results', results)
// })
// const sub = store.subscribe('allkv', new Set(['content']), {}, (type, txn, v) => {

const testSingle = () => {
  const store = augment(singleStore())
  const sub = store.subscribe('single', true, {}, (type, txn, v) => {
  // const sub = store.subscribe('content', true, {}, (type, txn, v) => {
    console.log('listener', type, v, txn)
  })
  sub.cursorAll({}, (err, results) => {
    console.log('cursor next', err, results)

    store.mutate('single', {type:'set', data: {x: 10}}, {}, {}, (err, v) => {
      console.log('mutate callback')
      console.log(err, v)

      store.fetch('single', true, {}, (err, results) => {
        console.log(err, results)
      })
    })
  })
}

const testMap = () => {
  const store = augment(kvStore())
  const sub = store.subscribe('allkv', true, {}, (type, txn, v) => {
  // const sub = store.subscribe('content', true, {}, (type, txn, v) => {
    console.log('listener', type, v, txn)
  })
  sub.cursorAll({}, (err, results) => {
    console.log('cursor next', err, results)

    const txn = new Map([['x', {type:'set', data: {x: 10}}]])
    store.mutate('resultmap', txn, {}, {}, (err, v) => {
      console.log('mutate callback')
      console.log(err, v)

      store.fetch('kv', new Set(['x']), {}, (err, results) => {
        console.log(err, results)
      })
    })
  })
}

const testMap2 = () => {
  const store = augment(kvStore())
  const txn = new Map([['x', {type:'set', data: {x: 10}}]])
  store.mutate('resultmap', txn, {}, {}, (err, v) => {
    if (err) throw err
    store.getOps!('allkv', true, {[store.sources[0]!]: {from:0, to:100}}, {}, (err, results) => {
      console.log(results)
    })
  })
}

// testMap()
testSingle()