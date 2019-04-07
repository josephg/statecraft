
import choo, { IState } from 'choo'
import html from 'choo/html'

import {I, subValues, subResults, sel, registerType, queryTypes, bitHas, version} from '@statecraft/core'
import {reconnectingclient, connectToWS} from '@statecraft/net'

import {type as texttype} from 'ot-text-unicode'
import {type as jsontype} from 'ot-json1'


registerType(texttype)
registerType(jsontype)

type Op = {v: (I.Version | null)[], op?: I.Op<any>, replace?: any}
type Ops = Op[]

interface State extends IState {
  sources: I.Source[]
  uid: string,
  versions: I.FullVersion
  data: any
  // selectedKey?: string
  connectionStatus: string
  prefer: 'pre' | 'html'
  opsForKey: Map<string, Ops>
}

const hex = (v: Uint8Array): string => (
  Array.prototype.map.call(v, (x: number) => ('00' + x.toString(16)).slice(-2)).join('')
)

const header = (state: State, emit: any) => {
  const {sources, uid, versions, connectionStatus, prefer} = state
  // console.log('v', versions)
  return html`
    <div id=header class=${connectionStatus}>
      Store: <span class=mon>${uid}</span>
      <span style="display: inline-block; width: 2em;"></span>
      Version: <span class=mon>${sources.map((s, i) => versions[i] && hex(versions[i]!)).join(', ')}</span>
      <span style="display: inline-block; width: 2em;"></span>
      <div class=button onclick=${() => {emit('set prefer', 'pre')}} disabled=${prefer === 'pre'}>PRE</div>
      <div class=button onclick=${() => {emit('set prefer', 'html')}} disabled=${prefer === 'html'}>HTML</div>
      <span class=right>${connectionStatus}</span>
    </div>
  `
}

const raw = (innerHTML: string) => {
  const elem = html`<div></div>`
  elem.innerHTML = innerHTML
  return elem
}

const opsView = (state: State, ops: Ops = []) => {
  return html`<div id=ops>
  ${ops.map(({v, op, replace}) => html`<div>
    <span class=mon>${v.map(vv => vv == null ? '␀' : hex(vv)).join(', ')}</span>
    ${op
      ? html`<span class=op>Op: ${JSON.stringify(op)}</div>`
      : html`<span class=replace>Replace: ${JSON.stringify(replace)}</div>`
    }
    </div>`)}
  </div>`
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
  // console.log('params', state.params)
  let selectedKey = state.params.wildcard
  // console.log('key', selectedKey)

  // If we have nothing selected, just select the first key in the data set.
  if (selectedKey == null || !data.has(selectedKey)) selectedKey = data.keys().next().value

  const selectedData = data.get(selectedKey)

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
      ${selectedData === undefined ?
        html`<div id=ops></div>`
        : opsView(state, state.opsForKey.get(selectedKey))
      }
    </div>
  </body>
  `
}

(async () => {
  const wsurl = `ws${window.location.protocol.slice(4)}//${window.location.host}/ws/`
  console.log('connecting to ws', wsurl, '...')
  const [statusStore, storeP, uidChanged] = reconnectingclient<any>(() => connectToWS(wsurl))
  uidChanged.catch(e => { location.reload() })

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
      for await (const status of subValues(I.ResultType.Single, statusStore.subscribe({type: I.QueryType.Single, q: true}))) {
        console.log('status', status)
        state.connectionStatus = status
        emitter.emit('render')
      }
    })()
  })
  
  app.use((_state, emitter) => {
    const state = _state as State
    state.sources = store.storeInfo.sources
    state.uid = store.storeInfo.uid
    state.data = null
    state.versions = []
    state.opsForKey = new Map()

    const getOps = (key: string) => {
      let ops = state.opsForKey.get(key)
      if (ops == null) {
        ops = []
        state.opsForKey.set(key, ops)
      }
      return ops
    }

    const pushOp = (k: string | null, op: Op) => {
      const ops = getOps(k == null ? 'single' : k)
      ops.unshift(op)
      if (ops.length > 20) ops.pop()
    }

    ;(async () => {
      const qt = store.storeInfo.capabilities.queryTypes
      const q: I.Query = bitHas(qt, I.QueryType.AllKV) ? {type: I.QueryType.AllKV, q:true}
        : bitHas(qt, I.QueryType.StaticRange) ? {type: I.QueryType.StaticRange, q: [{low: sel(''), high: sel('\xff')}]}
        // : qt.has('static range') ? {type: 'static range', q: [{low: sel('mdraw/'), high: sel('mdraw/~')}]}
        : {type: I.QueryType.Single, q:true}
      const rtype = queryTypes[q.type].resultType

      // I would love to just use subResults here, but 
      for await (const {raw, results, versions} of subResults(rtype.type!, store.subscribe(q))) {
        // console.log('results', results)
        
        state.data = rtype.type! === I.ResultType.Range
          ? new Map(results[0])
          : results
        // console.log('val', results, state.data, versions)

        const v = version.vRangeTo(versions)
        if (raw.replace) {
          rtype.mapReplace<any, void>(raw.replace.with, (val, k) => {
            pushOp(k, {v, replace: val})
          })
        }

        raw.txns.forEach(({txn}) => {
          rtype.mapTxn<any, void>(txn, (op, k) => {
            pushOp(k, {v, op})
            return null as any as I.Op<void> // It'd be better to have a forEach .. .eh.
          })
        })

        state.versions = v
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
