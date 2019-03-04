import * as I from '../interfaces'
import serve from './server'
import {Writable} from 'stream'
import {TinyReader, TinyWriter, wrapWriter, onMsg} from './tinystream'
import WebSocket from 'ws'
import {IncomingMessage} from 'http'
import { CSMsg, SCMsg } from './netmessages';

const isProd = process.env.NODE_ENV === 'production'

export const wrapWebSocket = <R, W>(socket: WebSocket): [TinyReader<R>, TinyWriter<W>] => {
  const reader: TinyReader<R> = {buf: [], isClosed: false}

  socket.on("message", data => {
    if (!isProd) console.log('C->S', data)
    onMsg(reader, JSON.parse(data as any))
  })

  // I could just go ahead and make a TinyWriter, but this handles
  // backpressure.
  const writer = new Writable({
    objectMode: true,
    write(data, _, callback) {
      if (!isProd) console.log('S->C', data)
      if (socket.readyState === socket.OPEN) {
        // TODO: Should this pass the callback? Will that make backpressure
        // work?
        socket.send(JSON.stringify(data))
      }
      callback()
    },
  })

  socket.on('close', () => {
    writer.end() // Does this help??
    reader.isClosed = true
    reader.onClose && reader.onClose()
  })

  return [reader, wrapWriter(writer)]
}

export const serveWS = <Val>(wsOpts: WebSocket.ServerOptions, store: I.Store<Val> | ((ws: WebSocket, msg: IncomingMessage) => I.Store<Val> | undefined | null)) => {
  const getStore = typeof store === 'function' ? store : () => store

  const wss = new WebSocket.Server(wsOpts)

  wss.on('connection', (socket, req) => {
    const [reader, writer] = wrapWebSocket<CSMsg, SCMsg>(socket)
    const store = getStore(socket, req)
    if (store != null) serve(reader, writer, store)
  })

  return wss
}

export default serveWS