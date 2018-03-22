import singleStore from './lib/stores/singlemem'
import augment from './lib/augment'

import createWss from './lib/wsserver'

import express = require('express')
import http = require('http')

const app = express()

console.log('dirname', __dirname)
// app.use(express.static(`${__dirname}/public`))
app.use(express.static(`public`))

const server = http.createServer(app)

const store = augment(singleStore())

const wss = createWss(store, {server})

server.listen(4411, () => {
  console.log('listening on port 4411')
})

// const sub = store.subscribe('single', true, {}, (type, txn, v) => {
//   console.log('listener', type, v, txn)
// })
// sub.cursorAll({}, (err, results) => {
//   console.log('cursor next', err, results)

//   store.mutate('single', {type:'set', data: {x: 10}}, {}, {}, (err, v) => {
//     console.log('mutate callback')
//     console.log(err, v)

//     store.fetch('single', true, {}, (err, results) => {
//       console.log(err, results)
//     })
//   })
// })

