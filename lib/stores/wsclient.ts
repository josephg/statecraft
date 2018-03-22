import * as I from '../types/interfaces'
import storeFromStreams, {
  TinyReader, TinyWriter
} from '../client'

export default function(path: string, callback: I.Callback<I.Store>) {
  // TODO: Auto-reconnection.
  const ws = new WebSocket('ws://' + window.location.host + path)

  ws.onopen = () => {console.log('ws opened')}
  ws.onerror = (e) => {console.error('ws error', e)}

  const reader: TinyReader = {}
  ws.onmessage = (msg) => {
    const data = JSON.parse(msg.data)
    console.log('received', data)
    reader.onmessage!(data)
  }

  const writer: TinyWriter = {
    write(data) {
      if (ws.readyState === ws.OPEN) {
        console.log('sending', data)
        ws.send(JSON.stringify(data))
      }
    },
    close() {
      ws.close()
    },
  }

  storeFromStreams(reader, writer, callback)
}