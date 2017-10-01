import singleStore from './stores/singlemem'
import kvStore from './stores/kvmem'
import prozessStore from './stores/prozessops'
import lmdbStore from './stores/lmdb'
import augment from './augment'

import {reconnecter} from 'prozess-client'

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
    store.getOps!('allkv', true, {[store.sources![0]!]: {from:0, to:100}}, {}, (err, results) => {
      console.log(results)
    })
  })
}

const testProzess = () => {
  prozessStore(9999, 'localhost', (err, _store) => {
    if (err) throw err
    const store = _store!
    store.onTxn = (source, from, to, type, txn) => {
      console.log('ontxn', source, from, to, type, txn)
    }
    const txn = new Map([['x', {type:'set', data: {x: 10}}]])
    store.mutate('resultmap', txn, {[store.sources![0]!]: 0}, {}, (err, v) => {
      if (err) throw err
      console.log('mutate cb', v)
    })
  })
}

const testLmdb = () => {
  const client = reconnecter(9999, 'localhost', err => {
    if (err) throw err

    const store = lmdbStore(client, process.argv[2] || 'testdb')

    store.onTxn = (source, from, to, type, txn) => {
      console.log('ontxn', source, from, to, type, txn)
    }
    const txn = new Map([['q', {type:'set', data: {x: (Math.random() * 100)|0}}]])
    console.log('source', store.sources)
    store.mutate('resultmap', txn, {[store.sources![0]!]: -1}, {}, (err, v) => {
      if (err) throw err
      console.log('mutate cb', v)

      store.fetch('kv', new Set(['x', 'y']), {}, (err, results) => {
        if (err) throw err
        console.log('fetch results', results)
        // store.close()
      })
    })

  })
  // prozessStore(9999, 'localhost', (err, opstore) => {
  //   if (err) throw err
  //   if (opstore == null) throw Error('inv store')
  //   const store = lmdbStore('testdb', opstore)

  // })

}

// testMap()
// testSingle()
// testProzess()
testLmdb()