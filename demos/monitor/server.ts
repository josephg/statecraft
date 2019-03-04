// This is the monitoring server / host.

// It exposes 2 endpoints:
// - TCP client for monitoring daemons to connect
// - HTTP listener + websockets for the monitoring app

import express from 'express'
import http from 'http'
import net from 'net'

import * as I from '../../lib/interfaces'
import kvMem from '../../lib/stores/kvmem'
import augment from '../../lib/augment'
import subValues from '../../lib/subvalues'
import { rmKV, setKV } from '../../lib/kv'
import { connectToSocket } from '../../lib/stores/tcpclient'
import serveWS from '../../lib/net/wsserver'

process.on('unhandledRejection', err => {
  console.error(err.stack)
  process.exit(1)
})

;(async () => {
  type CPU = {user: number, sys: number}
  type ClientInfo = {
    ip?: string,
    hostname: string,
    connected: boolean,
    cpus?: CPU[]
  }

  const store = augment(await kvMem<ClientInfo>())

  // 1. Setup the TCP server to listen for incoming clients

  // We sort of want to do the opposite of what tcpserver does - instead of
  // serving a store, we want to consume stores from incoming network
  // connections.
  const tcpserver = net.createServer(async socket => {
    console.log('got client')
    const ip = socket.remoteAddress

    // Set to the client's hostname once the client first sends us information
    let id: string | null = null

    const remoteStore = await connectToSocket<ClientInfo>(socket)
    const sub = remoteStore.subscribe({type: 'single', q: true})

    let lastVal: ClientInfo | null = null
    for await (const _val of subValues('single', sub)) {
      const val = _val as ClientInfo
      val.ip = ip
      if (id == null) id = val.hostname
      val.connected = true
      // console.log('val', val)
      console.log('update from', id)
      
      lastVal = val
      await setKV(store, id, val)
    }

    socket.on('close', async () => {
      console.log('closed', id)
      // if (id != null) await rmKV(store, id)
      if (lastVal != null) {
        lastVal.connected = false
        delete lastVal.cpus
        await setKV(store, id!, lastVal)
      }
    })
  })
  tcpserver.listen(3003)
  console.log('tcp server listening on port 3003')



  // 2. Set up the HTTP server & websocket listener for the dashboard
  const app = express()
  app.use(express.static(`${__dirname}/public`))

  const webServer = http.createServer(app)

  serveWS({server: webServer}, store)

  const port = process.env.PORT || 3000
  webServer.listen(port, (err: any) => {
    if (err) throw err
    console.log('http server listening on', port)
  })
})()