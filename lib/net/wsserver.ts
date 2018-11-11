import * as I from '../types/interfaces'
import * as N from './netmessages'
import serve from './server'
import {Writable} from 'stream'
import {TinyReader, TinyWriter, wrapWriter} from './tinystream'
import WebSocket = require('ws')

const isProd = process.env.NODE_ENV === 'production'

export const serveWS = (store: I.Store, wsOpts: WebSocket.ServerOptions) => {
  const wss = new WebSocket.Server(wsOpts)

  wss.on('connection', client => {
    const reader: TinyReader<N.CSMsg> = {isClosed: false}

    client.on("message", data => {
      if (!isProd) console.log('C->S', data)
      // reader.push(JSON.parse(data as any))
      reader.onmessage!(JSON.parse(data as any))
    })

    // I could just go ahead and make a TinyWriter, but this handles
    // backpressure.
    const writer = new Writable({
      objectMode: true,
      write(data, _, callback) {
        if (!isProd) console.log('S->C', data)
        if (client.readyState === client.OPEN) {
          // TODO: Should this pass the callback? Will that make backpressure
          // work?
          client.send(JSON.stringify(data))
        }
        callback()
      },
    })

    client.on('close', () => {
      writer.end() // Does this help??
      reader.isClosed = true
      reader.onclose && reader.onclose()
    })

    serve(reader, wrapWriter(writer), store)
  })

  return wss
}

export default serveWS