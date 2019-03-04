// This is an example store that can be connected to by the universal client

import net from 'net'

import * as I from '../../lib/interfaces'
import kvMem from '../../lib/stores/kvmem'
import augment from '../../lib/augment'
import subValues from '../../lib/subvalues'
import { rmKV, setKV } from '../../lib/kv'
import serve from '../../lib/net/tcpserver'

process.on('unhandledRejection', err => {
  console.error(err.stack)
  process.exit(1)
})

;(async () => {
  const store = augment(await kvMem(new Map([
    ['hi', {a:3, b:4}],
    ['yo there', {a:10, b:30}]
  ])))

  // setInterval(() => {
  //   setKV(store, 'x', {a: Math.random(), b: Math.random()})
  // }, 1000)

  const server = serve(store)
  server.listen(4444)
  console.log('listening on TCP port 4444')
})()