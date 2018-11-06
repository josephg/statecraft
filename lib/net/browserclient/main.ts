import html from 'nanohtml'
import connect from '../../stores/wsclient'
import render from './render'
import * as I from '../../types/interfaces'

declare const config: {
  key: string,
  initialValue: any,
  initialVersions: I.FullVersion,
}

// document.body.appendChild(html`<h1>oh hi</h1>`)

const content = document.getElementById('content')
if (content == null) throw Error('Could not find content root')
// content.appendChild(render('application/json', {x:5, y:[1,2,3]}))

;(async () => {
  const store = await connect('ws://localhost:2000/')

  // const vEnd: I.FullVersion = {}
  // for (const s in config.initialVersions) { vEnd[s] = config.initialVersions[s].to }
  // const sub = store.subscribe({type: 'kv', q: new Set([config.key])}, {knownAtVersions: vEnd})
  const sub = store.subscribe({type: 'kv', q: new Set([config.key])}, {
    knownDocs: new Set([config.key]),
    knownAtVersions: config.initialVersions,
  })
  await sub.cursorAll()

  for await (const data of sub) {
    console.log(data)
  }
})()