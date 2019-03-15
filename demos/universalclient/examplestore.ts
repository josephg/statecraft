// This is an example store that can be connected to by the universal client

import net from 'net'

import * as I from '../../lib/interfaces'
import {kvMem} from '../../lib/stores/kvmem'
import subValues from '../../lib/subvalues'
import { rmKV, setKV } from '../../lib/kv'
import serve from '../../lib/net/tcpserver'
import makeMap from '../../lib/stores/map'

process.on('unhandledRejection', err => {
  console.error(err.stack)
  process.exit(1)
})

;(async () => {
  const store = await kvMem(new Map([
    ['hi', {a:3, b:4}],
    ['yo', {a:10, b:30}]
  ]))

  setInterval(() => {
    setKV(store, 'x', {a: Math.random(), b: Math.random()})
  }, 1000)

  const mapStore = makeMap(store, ({a, b}) => {
    return "a + b is " + (a+b)
  })

  const server = serve(mapStore)
  server.listen(2002)
  console.log('listening on TCP port 2002')
})()