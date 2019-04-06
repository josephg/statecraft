import cpuStats from 'cpu-stats'
import net from 'net'
import os from 'os'

import singleMem, {setSingle} from '../../lib/stores/singlemem'
import { serveToSocket } from '../../lib/net/tcpserver';

process.on('unhandledRejection', err => {
  console.error(err.stack)
  process.exit(1)
})

type CPU = {user: number, sys: number}
type ClientInfo = {
  hostname: string,
  cpus: CPU[]
}

;(async () => {
  const port = process.env.PORT || 3003
  const host = process.env.HOST || 'localhost'

  const localStore = singleMem<ClientInfo | null>(null)

  let listening = false
  const listen = async () => {
    listening = true

    // We want to keep trying to reconnect here, so the dashboard can be restarted.
    while (true) {
      console.log('Connecting to monitoring server at', host)
      const socket = net.createConnection(+port, host)
      serveToSocket(localStore, socket)

      socket.on('connect', () => {console.log('connected')})

      await new Promise(resolve => {
        socket.on('error', err => {
          console.warn('Error connecting to monitoring server', err.message)
        })
        socket.on('close', hadError => {
          // console.log('closed', hadError)
          resolve()
        })
      })

      // Wait 3 seconds before trying to connect again.
      await new Promise(resolve => setTimeout(resolve, 3000))
    }
  }

  const hostname = os.hostname()

  const pollCpu = () => {
    cpuStats(1000, async (err, results) => {
      if (err) throw err // crash.

      process.stdout.write('.')

      const cpus = results.map(({cpu, user, sys}) => ({user, sys}))
      const info = {hostname, cpus}
      await setSingle(localStore, info)

      // We'll only connect after we have some data, to save on null checks.
      if (!listening) listen()

      pollCpu()
    })
  }

  pollCpu()
})()