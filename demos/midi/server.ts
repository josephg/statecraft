import {I, stores, rmKV, setKV, subValues} from '@statecraft/core'
import {wrapWebSocket, connectMux, BothMsg, tcpserver} from '@statecraft/net'
import express from 'express'
import WebSocket from 'ws'
import http from 'http'

// import kvMem from '../../lib/stores/kvmem'
import State from './state'

const {kvmem} = stores

process.on('unhandledRejection', err => {
  console.error((err as any).stack)
  process.exit(1)
})

;(async () => {
  // The store is a kv store mapping from client ID (incrementing numbers) => latest position.
  const store = await kvmem<State>()

  const app = express()
  app.use(express.static(`${__dirname}/public`))

  const server = http.createServer(app)
  const wss = new WebSocket.Server({server})

  let nextId = 1000

  wss.on('connection', async (socket, req) => {
    const id = `${nextId++}`

    const [reader, writer] = wrapWebSocket<BothMsg, BothMsg>(socket)
    const remoteStore = await connectMux<State>(reader, writer, store, false)

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
      if (process.env.DEBUG_NET) console.log('client value', val)
      await setKV(store, id, val)
    }
  })

  const port = process.env.PORT || 2444
  server.listen(port, () => {
    console.log('listening on', port)
  })


  if (process.env.NODE_ENV !== 'production') {
    const tcpServer = tcpserver(store)
    tcpServer.listen(2002, 'localhost')
    console.log('Debugging server listening on tcp://localhost:2002')
  }
})()