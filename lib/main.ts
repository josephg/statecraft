import singleStore from './stores/single'

const store = singleStore()

// store.fetch('all', null, {}, (err, results) => {
//   console.log('fetch results', results)
// })
// const sub = store.subscribe('allkv', new Set(['content']), {}, (type, txn, v) => {
const sub = store.subscribe('single', true, {}, (type, txn, v) => {
// const sub = store.subscribe('content', true, {}, (type, txn, v) => {
  console.log('listener', type, v, txn)
})
sub.cursorNext({}, (err, results) => {
  console.log('cursor next', err, results)

  store.mutate('single', {type:'set', data: {x: 10}}, {}, {}, (err, v) => {
    console.log('mutate callback')
    console.log(err, v)

    store.fetch('single', true, {}, (err, results) => {
      console.log(err, results)
    })
  })
})

