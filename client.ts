import createWSClient from './lib/stores/wsclient'

createWSClient('/', (err, store) => {
  if (err) throw err

  console.log('got store', store)
  ;(window as any)['store'] = store

  console.log('x')
  store!.fetch('single', true, {}, (err, result) => {
    if (err) throw err
    console.log('store has', result)
  })
})