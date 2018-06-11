import * as I from '../types/interfaces'
import storeFromStreams, {
  TinyReader, TinyWriter
} from '../net/client'
import WebSocket = require('isomorphic-ws')

// const global = (function(this: any) { return this })()
// 'ws://' + global.location.host + path

export default function(wsurl: string): Promise<I.Store> {
  // TODO: Auto-reconnection.
  const ws = new WebSocket(wsurl)

  ws.onopen = () => {console.log('ws opened')}
  ws.onerror = (e) => {console.error('ws error', e)}

  const reader: TinyReader = {}
  ws.onmessage = (msg) => {
    const data = JSON.parse(msg.data.toString())
    console.log('received', data)
    reader.onmessage!(data)
  }

  ws.onclose = () => {
    console.warn('---- WEBSOCKET CLOSED ----')
  }

  const writer: TinyWriter = {
    write(data) {
      if (ws.readyState === ws.OPEN) {
        console.log('sending', data)
        ws.send(JSON.stringify(data))
      } else {
        console.log('websocket message discarded because ws closed')
      }
    },
    close() {
      ws.close()
    },
  }

  return storeFromStreams(reader, writer)
}