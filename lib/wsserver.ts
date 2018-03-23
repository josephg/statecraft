import * as I from './types/interfaces'
import serve from './serve'
import {Readable, Writable, Transform} from 'stream'
import WebSocket = require('ws')

export default (store: I.Store, wsOpts: WebSocket.ServerOptions) => {
  const wss = new WebSocket.Server(wsOpts)

  wss.on('connection', client => {
    const reader = new Readable({
      objectMode: true,
      read() {},
    })

    client.on("message", data => {
      console.log('C->S', data)
      reader.push(JSON.parse(data as any))
    })

    const writer = new Writable({
      objectMode: true,
      write(data, _, callback) {
        console.log('S->C', data)
        if (client.readyState === client.OPEN) {
          client.send(JSON.stringify(data))
        }
        callback()
      },
    })

    client.on('close', () => {
      writer.end() // Does this help??
    })

    serve(reader, writer, store)
  })

  return wss
}