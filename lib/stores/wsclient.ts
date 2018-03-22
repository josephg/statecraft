import * as I from '../types/interfaces'
import storeFromStreams from '../netclient'
import {Readable, Writable, Transform} from 'stream'

export default function(path: string, callback: I.Callback<I.Store>) {
  // TODO: Auto-reconnection.
  const ws = new WebSocket('ws://' + window.location.host + path)

  ws.onopen = () => {console.log('ws opened')}
  ws.onerror = (e) => {console.error('ws error', e)}

  const reader = new Readable({
    objectMode: true,
    read() {},
  })
  ws.onmessage = (msg) => {
    const data = JSON.parse(msg.data)
    console.log('received', data)
    reader.push(data)
  }

  const writer = new Writable({
    objectMode: true,
    write(data) {
      console.log('sending', data)
      ws.send(JSON.stringify(data))
    },
  })

  storeFromStreams(reader, writer, callback)
}