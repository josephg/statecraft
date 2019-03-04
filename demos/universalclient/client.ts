
import choo from 'choo'
import html from 'choo/html'

import * as I from '../../lib/interfaces'
import reconnecter from '../../lib/stores/reconnectingclient'
import {connect} from '../../lib/stores/wsclient'
import subValues, { subResults } from '../../lib/subvalues'
import augment from '../../lib/augment'
import { vRangeTo } from '../../lib/version';

import {type as texttype} from 'ot-text-unicode'
import {register} from '../../lib/typeregistry'

import sel from '../../lib/sel'

register(texttype)

interface State {
  sources: I.Source[]
  versions: I.FullVersion
  data: any
  selectedKey?: string
  connectionStatus: string
}

const hex = (v: Uint8Array): string => (
  Array.prototype.map.call(v, (x: number) => ('00' + x.toString(16)).slice(-2)).join('')
)

const header = (state: State) => {
  const {sources, versions, connectionStatus} = state
  // console.log('v', versions)
  return html`
    <div id=header>Store [${sources.join(', ')}] Version ${sources.map(s => versions[s] && hex(versions[s])).join(', ')} conn ${connectionStatus}</div>
  `
}

const dataView = (val: any) => {
  return typeof val === 'string'
    ? html`
      <div id=content class=string><pre>${val}</pre></div>
    ` : html`
      <div id=content class=json><pre>${JSON.stringify(val, null, 2)}</pre></div>
    `
}

const singleView = (state: any, emit: any) => {
  return html`
  <body>
    <div id=container class=single>
      ${header(state)}
      ${dataView(state.data)}
    </div>
  </body>
  `
}

const kvView = (state: any, emit: any) => {
  const data = state.data as Map<string, any>
  
  const keys = Array.from(data.keys()).sort()
  const selectedKey = state.selectedKey
  const selectedData = data.get(selectedKey)

  // console.log('state', state)
  return html`
  <body>
  <div id=container class=kv>
    ${header(state)}
    <div id=keys>
      ${keys.map(k => html`<div
        class=${k === selectedKey ? 'selected' : ''}
        onclick=${() => {emit('select key', k)}}
      >${k}</div>`)}
    </div>
    ${selectedData === undefined ?
      html`<div id=content>Select a key on the left to inspect</div>`
      : dataView(selectedData)}
  </body>
  `
}

(async () => {
  const wsurl = `ws${window.location.protocol.slice(4)}//${window.location.host}/ws/`
  console.log('connecting to ws', wsurl, '...')
  const [statusStore, storeP] = reconnecter<any>(() => connect(wsurl))

  // console.log('x')
  // statusStore.onTxn = (source, fromV, toV, type, txn, rv, meta) => {
  //   console.log('connection status', rv)
  // }

  const store = await storeP
  
  const app = new choo()

  app.use((state, emitter) => {
    state.connectionStatus = 'loading'
    
    ;(async () => {
      // Using augment here is a very ... high level solution. It pulls in a lot more code.
      // It'd be good to have a subValues equivalent kind of function for simple stores.
      for await (const status of subValues('single', augment(statusStore).subscribe({type: 'single', q: true}))) {
        console.log('status', status)
        state.connectionStatus = status
        emitter.emit('render')
      }
    })()
  })

  app.use((state, emitter) => {
    state.sources = store.storeInfo.sources
    state.data = null
    state.versions = {}

    ;(async () => {
      const qt = store.storeInfo.capabilities.queryTypes
      const q: I.Query = qt.has('allkv') ? {type: 'allkv', q:true}
        : qt.has('static range') ? {type: 'static range', q: [{low: sel(''), high: sel('\xff')}]}
        // : qt.has('static range') ? {type: 'static range', q: [{low: sel('mdraw/'), high: sel('mdraw/~')}]}
        : {type: 'single', q:true}
      const rtype = ({allkv: 'kv', single: 'single', 'static range': 'range'} as any)[q.type]

      for await (const {results, versions} of subResults(rtype, store.subscribe(q))) {
        console.log('results', results)
        
        state.data = rtype === 'range'
          ? new Map(results[0])
          : results
        console.log('val', results, state.data, versions)

        state.versions = vRangeTo(versions)
        emitter.emit('render')
      }
    })()
  })

  app.use((state, emitter) => {
    state.selectedKey = null
    emitter.on('select key', (key: string) => {
      console.log('select key', key)
      state.selectedKey = key
      emitter.emit('render')
    })
  })

  app.route('/', (state, emit) => state.data instanceof Map
    ? kvView(state, emit)
    : singleView(state, emit)
  )
  app.mount('body')
})()
