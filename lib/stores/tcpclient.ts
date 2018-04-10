import * as I from '../types/interfaces'
import * as N from '../net/netmessages'
import storeFromStreams, {
  TinyReader, TinyWriter
} from '../net/client'

import net = require('net')
import msgpack = require('msgpack-lite')

export default function(port: number, host: string): Promise<I.Store> {
  const socket = net.createConnection(port, host)

  const writer: TinyWriter = {
    write(data) {
      if (socket.writable) {
        socket.write(msgpack.encode(data))
      }
    },
    close() {
      socket.end()
    }
  }

  // const writer = msgpack.createEncodeStream()
  // writer.pipe(socket)

  const readStream = msgpack.createDecodeStream()
  socket.pipe(readStream)

  const reader: TinyReader = {}
  readStream.on('data', msg => {
    reader.onmessage!(msg as any as N.SCMsg)
  })

  return storeFromStreams(reader, writer)
}