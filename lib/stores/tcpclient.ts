import * as I from '../interfaces'
import * as N from '../net/netmessages'
import createStore from '../net/client'
import {TinyReader, TinyWriter, wrapReader, wrapWriter} from '../net/tinystream'

import net from 'net'
import msgpack from 'msgpack-lite'

export default function<Val>(port: number, host: string): Promise<I.Store<Val>> {
  const socket = net.createConnection(port, host)

  const writer = wrapWriter<N.CSMsg>(socket, msgpack.encode)

  // const writer = msgpack.createEncodeStream()
  // writer.pipe(socket)

  const readStream = msgpack.createDecodeStream()
  socket.pipe(readStream)

  const reader = wrapReader<N.SCMsg>(readStream)

  return createStore(reader, writer)
}