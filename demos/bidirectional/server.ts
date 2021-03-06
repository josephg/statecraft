import * as I from '../../lib/interfaces'
import express from 'express'
import WebSocket from 'ws'
import http from 'http'

import {wrapWebSocket} from '../../lib/net/wsserver'
import kvMem from '../../lib/stores/kvmem'
// import singleMem, {setSingle} from '../../lib/stores/singlemem'
import connectMux, { BothMsg } from '../../lib/net/clientservermux'
import subValues from '../../lib/subvalues'
import { rmKV, setKV } from '../../lib/kv';
import serveTCP from '../../lib/net/tcpserver'

process.on('unhandledRejection', err => {
  console.error(err.stack)
  process.exit(1)
})

;(async () => {
  type Pos = {x: number, y: number}
  // type DbVal = {[id: string]: Pos}

  // The store is a kv store mapping from client ID (incrementing numbers) => latest position.
  const store = await kvMem<Pos>()

  const app = express()
  app.use(express.static(`${__dirname}/public`))

  const server = http.createServer(app)
  const wss = new WebSocket.Server({server})

  let nextId = 1000

  wss.on('connection', async (socket, req) => {
    const id = `${nextId++}`

    const [reader, writer] = wrapWebSocket<BothMsg, BothMsg>(socket)
    const remoteStore = await connectMux<Pos>(reader, writer, store, false)

    // console.log(id, 'info', remoteStore.storeInfo)
    console.log(id, 'client connected')
    const sub = remoteStore.subscribe({type: I.QueryType.Single, q: true})

    reader.onClose = () => {
      console.log(id, 'client gone')
      // delete db[id]
      // console.log('db', db)
      rmKV(store, id)
    }

    for await (const val of subValues(I.ResultType.Single, sub)) {
      // console.log(id, 'cu', val)
      // await setKV(store, id, {x: val.x, y: val.y})
      await setKV(store, id, val)
      // console.log('db', db)
    }
  })

  const port = process.env.PORT || 2222
  server.listen(port, (err: any) => {
    if (err) throw err
    console.log('listening on', port)
  })


  if (process.env.NODE_ENV !== 'production') {
    const tcpServer = serveTCP(store)
    tcpServer.listen(2002, 'localhost')
    console.log('Debugging server listening on tcp://localhost:2002')
  }
})()