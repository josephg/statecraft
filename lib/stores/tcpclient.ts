import * as I from '../interfaces'
import * as N from '../net/netmessages'
import createStore from '../net/client'
import {wrapReader, wrapWriter, TinyReader, TinyWriter} from '../net/tinystream'

import net, {Socket} from 'net'
import msgpack from 'msgpack-lite'

const wrap = <R, W>(socket: Socket): [TinyReader<R>, TinyWriter<W>] => {
  const writer = wrapWriter<W>(socket, msgpack.encode)
  
  const readStream = msgpack.createDecodeStream()
  socket.pipe(readStream)
  
  const reader = wrapReader<R>(readStream)
  return [reader, writer]
}

// We're exporting so many different variants here because they're useful for
// reconnecting clients and stuff like that.
export function createStreams<R, W>(port: number, host: string): Promise<[TinyReader<R>, TinyWriter<W>]> {
  const socket = net.createConnection(port, host)
  // return wrap<R, W>(socket)
  const pair = wrap<R, W>(socket)

  return new Promise((resolve, reject) => {
    socket.on('connect', () => resolve(pair))
    socket.on('error', reject)
  })
}

export function connectToSocket<Val>(socket: Socket): Promise<I.Store<Val>> {
  const [reader, writer] = wrap<N.SCMsg, N.CSMsg>(socket)
  return createStore(reader, writer)
}

export default function<Val>(port: number, host: string): Promise<I.Store<Val>> {
  const socket = net.createConnection(port, host)
  return connectToSocket(socket)
}