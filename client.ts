import createWSClient from './lib/stores/wsclient'
import {queryTypes} from './lib/types/queryops'
import assert = require('assert')

createWSClient('/', (err, _store) => {
  if (err) throw err

  const store = _store!

  console.log('got store', store)
  ;(window as any)['store'] = store

  store.fetch('kv', new Set(['a', 'b']), {}, (err, result) => {
    if (err) throw err
    console.log('store has', result)
  })

  const rtype = queryTypes['kv'].r
  let r = rtype.create()

  const sub = store.subscribe('kv', new Set(['a', 'b']), {}, (updates, version) => {
    // console.log('subscribe data', data.type, data.type === 'txns' ? data.txns : data.txn)

    if (updates.type === 'txns') {
      updates.txns.forEach(txn => rtype.applyMut!(r, txn.txn))
    } else {
      assert.strictEqual(updates.type, 'aggregate')
      rtype.applyMut!(r, updates.txn)
    }

    console.log('data ->', r)
  })
  sub.cursorAll()

  ;(window as any).sub = sub
})
