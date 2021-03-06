import choo from 'choo'
import html from 'choo/html'

import {I, subValues} from '@statecraft/core'
import {reconnectingclient, connectToWS} from '@statecraft/net'

type CPU = {user: number, sys: number}
type ClientInfo = {
  ip?: string,
  hostname: string,
  connected: boolean,
  cpus?: CPU[]
}

const machine = (val: ClientInfo) => {
  console.log('mach', val)
  return html`<div class="machine ${!val.connected ? 'disconnected' : ''}">
    <span>${val.hostname}</span>
    <span class=ip>${val.ip}</span>
    ${val.cpus && val.cpus.map(({user, sys}, i) => html`
      <span class=cpu>
        <span style="height: ${user+sys}%;"></span>
      </span>
    `)}
  </div>`
}

const mainView = (state: any) => {
  const machines = state.machines as Map<string, ClientInfo>
  // console.log('state', state)
  return html`
    <body>
      <h1>Statecraft CPU monitoring dashboard</h1>
      <hr>
      <div>
        ${Array.from(machines.values()).map(machine)}
      </div>
    </body>
  `
}

(async () => {
  const wsurl = `ws${window.location.protocol.slice(4)}//${window.location.host}/ws/`
  console.log('connecting to ws', wsurl, '...')
  const [statusStore, storeP] = reconnectingclient<ClientInfo>(() => connectToWS(wsurl))

  ;(async () => {
    for await (const status of subValues(I.ResultType.Single, statusStore.subscribe({type:I.QueryType.Single, q:true}))) {
      console.log('status', status)
    }
  })()

  const store = await storeP
  console.log('connected to', store.storeInfo.uid)
  
  const app = new choo()
  app.use((state, emitter) => {
    state.machines = new Map()
    ;(async () => {
      for await (const val of subValues(I.ResultType.KV, store.subscribe({type: I.QueryType.AllKV, q: true}))) {
        console.log('val', val)
        state.machines = val
        emitter.emit('render')
      }
    })()
  })
  app.route('/', mainView)
  app.mount('body')

})()
