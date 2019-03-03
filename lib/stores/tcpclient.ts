import * as I from '../interfaces'
import * as N from '../net/netmessages'
import createStore from '../net/client'
import {TinyReader, TinyWriter, wrapReader, wrapWriter} from '../net/tinystream'

import net, {Socket} from 'net'
import msgpack from 'msgpack-lite'

export function connectToSocket<Val>(socket: Socket): Promise<I.Store<Val>> {
  const writer = wrapWriter<N.CSMsg>(socket, msgpack.encode)
  
  const readStream = msgpack.createDecodeStream()
  socket.pipe(readStream)
  
  const reader = wrapReader<N.SCMsg>(readStream)
  
  return createStore(reader, writer)
}

export default function<Val>(port: number, host: string): Promise<I.Store<Val>> {
  const socket = net.createConnection(port, host)
  return connectToSocket(socket)
}