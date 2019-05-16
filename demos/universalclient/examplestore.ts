// This is an example store that can be connected to by the universal client

import net from 'net'

import {I, stores, subValues, setKV, rmKV} from '@statecraft/core'
import {tcpserver} from '@statecraft/net'
// import serve from '../../lib/net/tcpserver'
// import makeMap from '../../lib/stores/map'

const {kvmem, map: makeMap} = stores

process.on('unhandledRejection', err => {
  console.error((err as any).stack)
  process.exit(1)
})

;(async () => {
  const store = await kvmem(new Map([
    ['hi', {a:3, b:4}],
    ['yo', {a:10, b:30}]
  ]))

  setInterval(() => {
    setKV(store, 'x', {a: Math.random(), b: Math.random()})
  }, 1000)
  
  const server = tcpserver(store)
  // const mapStore = makeMap(store, ({a, b}) => {
  //   return "a + b is " + (a+b)
  // })

  // const server = tcpserver(mapStore)
  server.listen(2002)
  console.log('listening on TCP port 2002')
})()