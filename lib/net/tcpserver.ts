import * as I from '../interfaces'
import serve from './server'
import {wrapReader, wrapWriter} from './tinystream'

import net from 'net'
import msgpack from 'msgpack-lite'

export default (store: I.Store) => {
  // console.log('made store')
  return net.createServer(c => {
    // console.log('got connection')
    const writer = msgpack.createEncodeStream()
    writer.pipe(c)

    const reader = msgpack.createDecodeStream()
    c.pipe(reader)

    serve(wrapReader(reader), wrapWriter(writer), store)
  })
}