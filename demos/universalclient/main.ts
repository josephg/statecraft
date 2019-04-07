import express from 'express'
import http from 'http'
import net from 'net'
import url from 'url'
import {Console} from 'console'

import {I, sel, subValues, registerType} from '@statecraft/core'
import {tcpclient, createTCPStreams, wsclient, connectToWS, reconnectingclient, wsserver} from '@statecraft/net'

// import {type as texttype} from 'ot-text-unicode'
// import {type as jsontype} from 'ot-json1'

// registerType(texttype)
// registerType(jsontype)

process.on('unhandledRejection', err => {
  console.error((err as any).stack)
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
  while (true) {
    const [status, storeP, uidChanged] = reconnectingclient(type === 'ws'
      ? () => connectToWS(urlStr)
      : () => createTCPStreams(+(port || 3000), hostname)
    )
    const store = await storeP

    // TODO: Listen to status...
      
    console.log('got store', store.storeInfo)

    // Ok, now host the client app.
    const app = express()
    app.use(express.static(`${__dirname}/public`))

    const webServer = http.createServer(app)

    const wss = wsserver({server: webServer}, store)

    const listenPort = process.env.PORT || 3333
    webServer.listen(listenPort, () => {
      console.log('http server listening on', listenPort)
    })

    await uidChanged.catch(() => {})
    console.log('UID changed. Re-hosting.')

    // Closing the server entirely forces all ws clients to reconnect
    await new Promise(resolve => wss.close(resolve))
    await new Promise(resolve => webServer.close(resolve))
  }

  // const sub = store.subscribe({type: 'static range', q: [{low: sel(''), high: sel('\xff')}]})
  // for await (const cu of subValues('range', sub)) {
  //   console.log('cu', cu)
  // }
})()