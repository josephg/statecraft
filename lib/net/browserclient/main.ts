import html from 'nanohtml'
import connect from '../../stores/wsclient'
import render from './render'
import * as I from '../../types/interfaces'
import fieldOps from '../../types/fieldops'


declare const config: {
  mimetype: string,
  key: string,
  initialValue: any,
  initialVersions: I.FullVersion,
}

// document.body.appendChild(html`<h1>oh hi</h1>`)

const content = document.getElementById('content')
if (content == null) throw Error('Could not find content root')
// content.appendChild(render('application/json', {x:5, y:[1,2,3]}))

const container = document.getElementById('content')
if (container == null) throw Error('Could not find document #content div')
const setObj = (data: any) => {
  console.log('setobj', data)
  if (typeof data === 'object' && data.type === 'Buffer') {
    const blob = new Blob([new Uint8Array(data.data)], {type: config.mimetype})
    data = URL.createObjectURL(blob)
  }

  const replace = (elem: HTMLElement | null) => {
    while (container.firstChild) container.removeChild(container.firstChild);
    if (elem != null) {
      container.appendChild(elem)
    }
  }
  const result = data == null ? null : render(config.mimetype, data)
  if (result instanceof HTMLImageElement) {
    if (result.complete) replace(result)
    else result.onload = () => replace(result)
  } else {
    replace(result)
  }
}

;(async () => {
  const store = await connect('ws://localhost:2000/')

  // This would all be waaaay cleaner if we had a map from kv store -> single store.

  const sub = store.subscribe({type: 'kv', q: new Set([config.key])}, {
    knownDocs: new Set([config.key]),
    knownAtVersions: config.initialVersions,
  })
  await sub.cursorAll()
  let last: any = null

  // const r = new Map()
  for await (const update of sub) {
    if (update.replace) {
      const q = update.replace.q
      if (q == null) throw Error('Invalid update')
      else if (q.type === 'allkv' || q.type === 'single') {
        throw Error('unimplemented')
      } else if (q.type === 'kv') {
        if (q.q.has(config.key)) {
          const val = update.replace.with.get(config.key)
          setObj(val)
          last = val
        }
      }
    }

    update.txns.forEach(txn => {
      console.warn('txn', txn) // NOT PROCESSING

      const op = (txn.txn as I.KVTxn).get(config.key)
      if (op != null) {
        last = fieldOps.apply(last, op)
        setObj(last)
      }
    })
    // update.txns.forEach(txn => rtype.applyMut!(r, txn.txn))
    // TODO: And update the versions?
  }
})()