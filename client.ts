import createWSClient from './lib/stores/wsclient'
import {queryTypes} from './lib/types/queryops'
import assert = require('assert')

process.on('unhandledRejection', err => { throw err })

;(async () => {
  const store = await createWSClient('/')

  console.log('got store', store)
  ;(window as any)['store'] = store

  const result = await store.fetch({type: 'allkv'})
  console.log('store has', result)

  const rtype = queryTypes.allkv.r
  let r = rtype.create()

  const sub = store.subscribe({type: 'allkv'}, {}, (update, version) => {
    // console.log('subscribe data', data.type, data.type === 'txns' ? data.txns : data.txn)

    if (update.replace) {
      // Only supporting kv for now.
      const q = update.queryChange
      if (q == null) throw Error('Invalid update')
      else if (q.type === 'allkv' || q.type === 'single') {
        r = update.replace
      } else if (q.type === 'kv') {
        for (const k of q.q) {
          const val = update.replace.get(k)
          if (val == null) r.delete(k)
          else r.set(k, val)
        }

      } //else throw Error('Not supported query replacement type ' + q.type)
    }
    update.txns.forEach(txn => rtype.applyMut!(r, txn.txn))

    console.log('data ->', r)
  })
  sub.cursorAll()

  ;(window as any).sub = sub
})()
