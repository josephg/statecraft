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
      console.log('got data', data)
      reader.push(JSON.parse(data as any))
    })

    const writer = new Writable({
      objectMode: true,
      write(chunk, _, callback) {
        client.send(JSON.stringify(chunk))
        callback()
      },
    })

    serve(reader, writer, store)
  })

  return wss
}