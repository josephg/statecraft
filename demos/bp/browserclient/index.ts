// This is the main entrypoint for the in-browser viewer of live data.

import html from 'nanohtml'
import render from './render'

// Should be able to use an alias here, but its broken in tsify for some reason.
import * as I from '../../../lib/types/interfaces'
import connect from '../../../lib/stores/wsclient'
import fieldOps from '../../../lib/types/fieldops'
import onekey from '../../../lib/stores/onekey'


declare const config: {
  mimetype: string,
  key: string,
  initialValue: any,
  initialVersions: I.FullVersion,
}

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
  const store = onekey(await connect('ws://localhost:2000/'), config.key)

  const sub = store.subscribe({type: 'single', q: true}, {
    knownDocs: true,
    knownAtVersions: config.initialVersions,
  })
  await sub.cursorAll()
  let last: any = null

  // const r = new Map()
  for await (const update of sub) {
    if (update.replace) {
      const val = update.replace.with
      setObj(val)
      last = val
    }

    update.txns.forEach(txn => {
      last = fieldOps.apply(last, txn.txn as I.SingleTxn)
      setObj(last)
    })
  }
})()