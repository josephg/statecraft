import express from 'express'
import http from 'http'
import net from 'net'
import url from 'url'
import {Console} from 'console'

import * as I from '../../lib/interfaces'
import tcpClient, { createStreams } from '../../lib/stores/tcpclient'
import wsClient, {connect as connectWS} from '../../lib/stores/wsclient'
import reconnector from '../../lib/stores/reconnectingclient'
import serveWS from '../../lib/net/wsserver'
import sel from '../../lib/sel';
import subValues from '../../lib/subvalues';

process.on('unhandledRejection', err => {
  console.error(err.stack)
  process.exit(1)
})

global.console = new (Console as any)({
  stdout: process.stdout,
  stderr: process.stderr,
  inspectOptions: {depth: null}
})

;(async () => {
  const urlStr = process.argv[2]
  if (urlStr == null) throw Error('Missing URL argument')

  console.log(urlStr)

  const type = (urlStr.startsWith('ws://') || urlStr.startsWith('wss://')) ? 'ws'
    : urlStr.startsWith('tcp://') ? 'tcp'
    : null
  if (type == null) throw Error('URL must start with ws:// or tcp://')
  const {hostname, port} = url.parse(urlStr)
  if (hostname == null) throw Error('invalid URL')

  // TODO: Pick a default port number for statecraft
  // const store = type === 'ws' ? await wsClient(urlStr)
  //   : await tcpClient(+(port || 3000), host!)
  const [status, storeP] = reconnector(type === 'ws'
    ? () => connectWS(urlStr)
    : () => createStreams(+(port || 3000), hostname)
  )
  const store = await storeP

  // TODO: Listen to status...
    
  console.log('got store', store.storeInfo)

  // Ok, now host the client app.
  const app = express()
  app.use(express.static(`${__dirname}/public`))

  const webServer = http.createServer(app)

  serveWS({server: webServer}, store)

  const listenPort = process.env.PORT || 3333
  webServer.listen(listenPort, (err: any) => {
    if (err) throw err
    console.log('http server listening on', listenPort)
  })

  // const sub = store.subscribe({type: 'static range', q: [{low: sel(''), high: sel('\xff')}]})
  // for await (const cu of subValues('range', sub)) {
  //   console.log('cu', cu)
  // }
})()