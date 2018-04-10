import * as I from '../types/interfaces'
import serve from './server'

import net = require('net')
import msgpack = require('msgpack-lite')

export default (store: I.Store) => {
  // console.log('made store')
  return net.createServer(c => {
    // console.log('got connection')
    const writer = msgpack.createEncodeStream()
    writer.pipe(c)

    const reader = msgpack.createDecodeStream()
    c.pipe(reader)

    serve(reader, writer, store)
  })
}