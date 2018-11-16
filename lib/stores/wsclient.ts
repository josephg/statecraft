import * as I from '../types/interfaces'
import * as N from '../net/netmessages'
import storeFromStreams from '../net/client'
import {TinyReader, TinyWriter} from '../net/tinystream'
import WebSocket from 'isomorphic-ws'

// const wsurl = `ws${window.location.protocol.slice(4)}//${window.location.host}/ws`

// TODO: Implement automatic reconnection and expose a simple server
// describing the connection state
export default function(wsurl: string): Promise<I.Store> {
  const ws = new WebSocket(wsurl)

  ws.onopen = () => {console.log('ws opened')}
  ws.onerror = (e) => {console.error('ws error', e)}

  const reader: TinyReader<N.SCMsg> = {isClosed: false}
  ws.onmessage = (msg) => {
    const data = JSON.parse(msg.data.toString())
    console.log('received', data)
    reader.onmessage!(data)
  }

  ws.onclose = () => {
    console.warn('---- WEBSOCKET CLOSED ----')
    reader.isClosed = true
    reader.onclose && reader.onclose()
  }

  const writer: TinyWriter<N.CSMsg> = {
    write(data) {
      if (ws.readyState === ws.OPEN) {
        console.log('sending', data)
        ws.send(JSON.stringify(data))
      } else {
        // This looks bad, but its ok in practice here because the first
        // message sent is server -> client. So we can't send anything until
        // the connection is open anyway.
        console.log('websocket message discarded because ws closed')
      }
    },
    close() {
      ws.close()
    },
  }

  return storeFromStreams(reader, writer)
}