
import choo, { IState } from 'choo'
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

interface State extends IState {
  sources: I.Source[]
  versions: I.FullVersion
  data: any
  // selectedKey?: string
  connectionStatus: string
  prefer: 'pre' | 'html'
}

const hex = (v: Uint8Array): string => (
  Array.prototype.map.call(v, (x: number) => ('00' + x.toString(16)).slice(-2)).join('')
)

const header = (state: State, emit: any) => {
  const {sources, versions, connectionStatus, prefer} = state
  // console.log('v', versions)
  return html`
    <div id=header class=${connectionStatus}>
      Store: <span class=mon>${sources.join(', ')}</span>
      <span style="display: inline-block; width: 2em;"></span>
      Version: <span class=mon>${sources.map(s => versions[s] && hex(versions[s])).join(', ')}</span>
      <span style="display: inline-block; width: 2em;"></span>
      <div class=button onclick=${() => {emit('set prefer', 'html')}} disabled=${prefer === 'html'}>Prefer HTML</div>
      <div class=button onclick=${() => {emit('set prefer', 'pre')}} disabled=${prefer === 'pre'}>Prefer PRE</div>
      <span class=right>${connectionStatus}</span>
    </div>
  `
}

const raw = (innerHTML: string) => {
  const elem = html`<div></div>`
  elem.innerHTML = innerHTML
  return elem
}

const dataView = (state: State, val: any) => {
  const {prefer} = state
  return typeof val === 'string'
    ? prefer === 'pre'
      ? html`<div id=content class=string><pre>${val}</pre></div>`
      : html`<div id=content class=string>${raw(val)}</div>`
    : html`
      <div id=content class=json><pre>${JSON.stringify(val, null, 2)}</pre></div>
    `
}

const singleView = (state: State, emit: any) => {
  return html`
  <body>
    <div id=container class=single>
      ${header(state, emit)}
      ${dataView(state, state.data)}
    </div>
  </body>
  `
}

const kvView = (state: State, emit: any) => {
  const data = state.data as Map<string, any>
  
  const keys = Array.from(data.keys()).sort()
  console.log('params', state.params)
  const selectedKey = state.params.wildcard
  console.log('key', selectedKey)
  const selectedData = selectedKey ? data.get(selectedKey) : null

  // ${keys.map(k => html`<div
  //   class=${k === selectedKey ? 'selected' : ''}
  //   onclick=${() => {emit('select key', k)}}
  // >${k}</div>`)}
  // console.log('state', state)
  return html`
  <body>
    <div id=container class=kv>
      ${header(state, emit)}
      <div id=keys>
        ${keys.map(k => html`<a
          class=${k === selectedKey ? 'selected' : ''}
          href="#${k}"
        >${k}</a>`)}
      </div>
      ${selectedData === undefined ?
        html`<div id=content>Select a key on the left to inspect</div>`
        : dataView(state, selectedData)
      }
    </div>
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
        // console.log('val', results, state.data, versions)

        state.versions = vRangeTo(versions)
        emitter.emit('render')
      }
    })()
  })

  app.use((state, emitter) => {
    state.prefer = 'pre'
    emitter.on('set prefer', p => {
      state.prefer = p
      emitter.emit('render')
    })
  })

  const root = (state: IState, emit: any) => (state.data instanceof Map
    ? kvView(state as State, emit)
    : singleView(state as State, emit)
  )
  app.route('/', root)
  app.route('#*', root)

  app.mount('body')
})()
