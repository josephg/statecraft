import * as I from '../types/interfaces'
import * as N from '../net/netmessages'
import storeFromStreams from '../net/client'
import {TinyReader, TinyWriter, wrapReader, wrapWriter} from '../net/tinystream'

import net = require('net')
import msgpack = require('msgpack-lite')

export default function(port: number, host: string): Promise<I.Store> {
  const socket = net.createConnection(port, host)

  const writer = wrapWriter<N.CSMsg>(socket, msgpack.encode)

  // const writer = msgpack.createEncodeStream()
  // writer.pipe(socket)

  const readStream = msgpack.createDecodeStream()
  socket.pipe(readStream)

  const reader = wrapReader<N.SCMsg>(readStream)

  return storeFromStreams(reader, writer)
}