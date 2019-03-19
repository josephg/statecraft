
import reconnecter from '../../lib/stores/reconnectingclient'
import {connect} from '../../lib/stores/wsclient'
import subValues from '../../lib/subvalues'
import augment from '../../lib/augment'
import simpleValuesSingle from '../../lib/simplevalues'

import choo from 'choo'
import html from 'choo/html'

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
  const [statusStore, storeP] = reconnecter<ClientInfo>(() => connect(wsurl))

  ;(async () => {
    for await (const status of simpleValuesSingle(statusStore)) {
      console.log('status', status)
    }
  })()

  const store = await storeP
  console.log('connected to', store.storeInfo.uid)
  
  const app = new choo()
  app.use((state, emitter) => {
    state.machines = new Map()
    ;(async () => {
      for await (const val of subValues('kv', store.subscribe({type: 'allkv', q: true}))) {
        console.log('val', val)
        state.machines = val
        emitter.emit('render')
      }
    })()
  })
  app.route('/', mainView)
  app.mount('body')

})()
