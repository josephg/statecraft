import * as I from '../../lib/types/interfaces'
import * as N from '../../lib/net/netmessages'
import singleStore from '../../lib/stores/singlemem'
import augment from '../../lib/augment'
import {inspect} from 'util'

import {Readable, Writable} from 'stream'
import {TinyReader, TinyWriter, wrapReader, wrapWriter} from '../../lib/net/tinystream'
import connectMux from '../../lib/net/clientservermux'
// import createServer from '../../lib/net/tcpserver'
// import connectStore from '../../lib/stores/tcpclient'

process.on('unhandledRejection', err => { throw err })

const store1 = augment(singleStore('store1'))
const store2 = augment(singleStore('store2'))

const createPair = <T>(): [TinyReader<T>, TinyWriter<T>] => {
  // const r = new Readable({objectMode: true})
  // r._read = () => {}
  // const w = new Writable({objectMode: true})
  // w._write = () => {}
  // r.pipe(w)

  // const reader = wrapReader(r)
  // const writer = wrapWriter(w)

  const reader: TinyReader<T> = {isClosed: false}
  const writer: TinyWriter<T> = {
    write(msg) { process.nextTick(() => reader.onmessage!(msg)) },
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

  console.log('store1', await remoteStore1.fetch({type: 'single', q:true}))
  console.log('store2', await remoteStore2.fetch({type: 'single', q:true}))

  const sub = remoteStore1.subscribe({type: 'single', q: true}, {})
  ;(async () => {
    for await (const data of sub) {
      console.log('subscribe data', inspect(data, false, 10, true))
    }
  })()
  const results = await sub.cursorAll()
  console.log('cursor next', results)

  const v = await remoteStore1.mutate('single', {type:'set', data: {x: 10}})
  console.log('mutate run', v)

})()
