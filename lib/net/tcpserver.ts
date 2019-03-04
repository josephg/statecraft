import * as I from '../interfaces'
import serve from './server'
import {wrapReader, wrapWriter} from './tinystream'

import net, { Socket } from 'net'
import msgpack from 'msgpack-lite'
import { write } from 'fs';

export const serveToSocket = <Val>(store: I.Store<Val>, socket: Socket) => {
  const writer = msgpack.createEncodeStream()
  writer.pipe(socket)
  socket.on('end', () => {
    // This isn't passed through for some reason.
    writer.end()
  })
  
  const reader = msgpack.createDecodeStream()
  socket.pipe(reader)
  
  serve(wrapReader(reader), wrapWriter(writer), store)
}

export default <Val>(store: I.Store<Val>) => {
  return net.createServer(c => {
    // console.log('got connection')
    serveToSocket(store, c)
  })
}