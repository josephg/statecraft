import {I, stores, rmKV, setKV, subValues, registerType, resultTypes, catchupStateMachine} from '@statecraft/core'
import {wrapWebSocket, connectMux, BothMsg, tcpserver} from '@statecraft/net'
import express from 'express'
import WebSocket from 'ws'
import http from 'http'

// import kvMem from '../../lib/stores/kvmem'
import State from './state'
import {type as jsonType, JSONOp} from 'ot-json1'
registerType(jsonType)

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

    const sm = catchupStateMachine(I.ResultType.Single)
    for await (const cu of sub) {
      // Most updates are just going to be a single JSON transaction. If thats the case, just port the transaction.

      // TODO: This code is way more complicated than I'd like. A functionally
      // equivalent (but much simpler) version is commented below. But, doing it
      // this way keeps network traffic down. Consider making a utility method
      // out of this sort of thing in the future.
      const newVal = sm(cu).results

      // Each transaction in the catchup might be a list or a single item. Throw
      // everything away except the ops themselves.
      const ops = ([] as I.SingleOp<State>[]).concat(...cu.txns.map(({txn}) => txn as I.SingleTxn<State>))
      if (cu.replace || ops.find(op => op.type !== 'json1')) await setKV(store, id, newVal)
      else {
        // Flatten ops into a single json1 operation using compose() and send it.
        const op = ops.map(({data}) => data as JSONOp).reduce(jsonType.compose)
        await store.mutate(I.ResultType.KV, new Map([[id, {type: 'json1', data: op}]]))
      }
    }
    // for await (const val of subValues(I.ResultType.Single, sub)) {
    //   await setKV(store, id, val)
    // }
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