import * as I from '../../lib/interfaces'
import express from 'express'
import WebSocket from 'ws'
import http from 'http'

import {wrapWebSocket} from '../../lib/net/wsserver'
// import kvStore from '../../lib/stores/kvmem'
import singleMem, {setSingle} from '../../lib/stores/singlemem'
import augment from '../../lib/augment'
import connectMux from '../../lib/net/clientservermux'
import subValues from '../../lib/subvalues'

type Pos = {x: number, y: number}
type DbVal = {[id: string]: Pos}

// This is a huge hack
const db: DbVal = {}

const store = augment(singleMem<DbVal>(db))

const app = express()
app.use(express.static(`${__dirname}/public`))

const server = http.createServer(app)
const wss = new WebSocket.Server({server})

let nextId = 1000

wss.on('connection', async (socket, req) => {
  let id = nextId++

  const [reader, writer] = wrapWebSocket(socket)
  const remoteStore = await connectMux<DbVal, Pos>(reader, writer, store, false)

  // console.log(id, 'info', remoteStore.storeInfo)
  console.log(id, 'client connected')
  const sub = remoteStore.subscribe({type: 'single', q: true})

  reader.onClose = () => {
    console.log(id, 'client gone')
    delete db[id]
    // console.log('db', db)
    setSingle(store, db)
  }

  for await (const val of subValues(sub)) {
    // console.log(id, 'cu', val)
    db[id] = {x: val.x, y: val.y}
    // console.log('db', db)
    setSingle(store, db)
  }
})

const port = process.env.PORT || 2222
server.listen(port, (err: any) => {
  if (err) throw err
  console.log('listening on', port)
})