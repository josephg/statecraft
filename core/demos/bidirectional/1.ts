import * as I from '../../lib/interfaces'
import * as N from '../../lib/net/netmessages'
import singleStore from '../../lib/stores/singlemem'
import {inspect} from 'util'

import {TinyReader, TinyWriter, wrapReader, wrapWriter} from '../../lib/net/tinystream'
import connectMux from '../../lib/net/clientservermux'
// import createServer from '../../lib/net/tcpserver'
// import connectStore from '../../lib/stores/tcpclient'

process.on('unhandledRejection', err => { throw err })

const store1 = singleStore('store1')
const store2 = singleStore('store2')

const createPair = <T>(): [TinyReader<T>, TinyWriter<T>] => {
  const reader: TinyReader<T> = {buf: [], isClosed: false}
  const writer: TinyWriter<T> = {
    write(msg) {
      // console.log('msg', msg)
      process.nextTick(() => reader.onMessage!(msg))
    },
    close() {},
  }
  return [reader, writer]
}

type BothMsg = N.CSMsg | N.SCMsg
const [r1, w2] = createPair<BothMsg>()
const [r2, w1] = createPair<BothMsg>()

;(async () => {
  const remoteStore2P = connectMux(r1, w1, store1, true)
  const remoteStore1P = connectMux(r2, w2, store2, false)

  const [remoteStore2, remoteStore1] = await Promise.all([remoteStore2P, remoteStore1P])

  console.log('store1', await remoteStore1.fetch({type: I.QueryType.Single, q:true}))
  console.log('store2', await remoteStore2.fetch({type: I.QueryType.Single, q:true}))

  const sub = remoteStore1.subscribe({type: I.QueryType.Single, q: true}, {})
  const results = await sub.next()
  console.log('initial', results.value)
  
  ;(async () => {
    for await (const data of sub) {
      console.log('subscribe data', inspect(data, false, 10, true))
    }
  })()

  const v = await remoteStore1.mutate(I.ResultType.Single, {type:'set', data: {x: 10}})
  console.log('mutate run', v)

})()
