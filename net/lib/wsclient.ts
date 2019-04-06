import {I} from '@statecraft/core'
import * as N from './netmessages'
import createStore from './client'
import {TinyReader, TinyWriter, onMsg} from './tinystream'
import WebSocket from 'isomorphic-ws'

// const wsurl = `ws${window.location.protocol.slice(4)}//${window.location.host}/ws`

export const connect = <R, W>(wsurl: string): Promise<[TinyReader<R>, TinyWriter<W>]> => new Promise((resolve, reject) => {
  const ws = new WebSocket(wsurl)

  const reader: TinyReader<R> = {buf: [], isClosed: false}
  ws.onmessage = (msg) => {
    const data = JSON.parse(msg.data.toString())
    // console.log('received', data)
    onMsg(reader, data)
  }

  ws.onclose = () => {
    console.warn('---- WEBSOCKET CLOSED ----')
    reader.isClosed = true
    reader.onClose && reader.onClose()
  }

  const writer: TinyWriter<W> = {
    write(data) {
      if (ws.readyState === ws.OPEN) {
        // console.log('sending', data)
        ws.send(JSON.stringify(data))
      } else {
        // On regular connections this won't happen because the first
        // message sent is server -> client. So we can't send anything until
        // the connection is open anyway. Its a problem with clientservermux though
        console.log('websocket message discarded because ws closed')
      }
    },
    close() {
      ws.close()
    },
  }

  ws.onopen = () => {
    console.log('ws opened')
    resolve([reader, writer])
  }
  ws.onerror = (e) => {
    console.error('ws error', e)
    reject(e)
  }
})

// TODO: Implement automatic reconnection and expose a simple server
// describing the connection state
export default async function<Val>(wsurl: string): Promise<I.Store<Val>> {
  const [r, w] = await connect<N.SCMsg, N.CSMsg>(wsurl)
  return createStore(r, w)
}