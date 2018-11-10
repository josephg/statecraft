// This is a simple collaborative text editing demo.

// Features:
// - Live markdown rendering


// TODO:
// - Collaborative editing
// - Security around the editing capability

import * as I from '../../lib/types/interfaces'
import lmdbStore from '../../lib/stores/lmdb'
import augment from '../../lib/augment'
import kvStore from '../../lib/stores/kvmem'
import otStore from '../../lib/stores/ot'
import mapStore from '../../lib/stores/map'
import router, {ALL} from '../../lib/stores/router'
import createWss from '../../lib/net/wsserver'
import {register} from '../../lib/types/registry'

import http = require('http')

import express = require('express')
import jsesc = require('jsesc')

import assert = require('assert')
import commonmark = require('commonmark')
// import commonmark from 'commonmark'

import ottext = require('ot-text')

process.on('unhandledRejection', err => { throw err })

register(ottext.type)

const rootStore = otStore(augment(kvStore(undefined, {source: 'rootstore'})))

const store = router()
store.mount(rootStore, 'raw/', ALL, '', true)
store.mount(mapStore(rootStore, (v, k) => {
  console.log('v', v)
  const parser = new commonmark.Parser({smart: true})
  const writer = new commonmark.HtmlRenderer({smart: true, safe: true})
  
  const tree = parser.parse(v)
  return writer.render(tree)
  // return Buffer.from(mod.convert(v.img, 8, 1, 2) as any)
}), 'md/', ALL, '', false)

interface HTMLDocData {
  headers: {[k: string]: string},
  data: string | Buffer,
}

const changePrefix = (k: I.Key, fromPrefix: string, toPrefix: string) => {
  assert(k.startsWith(fromPrefix), `'${k}' does not start with ${fromPrefix}`)
  return toPrefix + k.slice(fromPrefix.length)
}

const render = (value: string | null, key: I.Key, versions: I.FullVersion) => (
  {
    headers: {
      'x-sc-version': JSON.stringify(versions),
      // ETAG.
      'content-type': 'text/html',
    },
    data: `<!doctype html>
<link rel="stylesheet" type="text/css" href="/style.css" />
<textarea id=content autofocus>${value || 'YOOOOOOO'}</textarea>
<script>
const config = ${jsesc({
  key,
  initialValue: value,
  initialVersions: versions
} as any)}
</script>
<script src="/bundle.js"></script>
`
  }
)

store.mount(
  mapStore(rootStore, (value, key, versions) => render(value, 'raw/' + key!, versions)),
  'editor/', ALL, '', false
)


const app = express()
app.use(express.static(`${__dirname}/public`))

const resultingVersion = (v: I.FullVersionRange): I.FullVersion => {
  const result: I.FullVersion = {}
  for (const s in v) result[s] = v[s].to
  return result
}

app.get('/edit/:name', async (req, res, next) => {
  const {name} = req.params
  const k = `editor/${name}`
  const result = await store.fetch({type: 'kv', q: new Set([k])})
  console.log('Got result from', k, result.results)
  const value = result.results.get(k) || render(null, `raw/${name}`, resultingVersion(result.versions))
  if (value == null) return next()
  
  res.set(value.headers)
  res.send(value.data)
})

// TODO: Refactor this to share code with the above.
app.get('/md/:name', async (req, res, next) => {
  const {name} = req.params
  const k = `md/${name}`
  const result = await store.fetch({type: 'kv', q: new Set([k])})
  const value = result.results.get(k)
  if (value == null) return next()
  res.setHeader('x-sc-version', JSON.stringify(result.versions))
  res.setHeader('content-type', 'application/json')
  res.send(`<!doctype html>
<div id=content>${value}</div>
`)
})

app.get('/raw/:name', async (req, res, next) => {
  const {name} = req.params
  const k = `raw/${name}`
  const result = await store.fetch({type: 'kv', q: new Set([k])})
  const value = result.results.get(k)
  if (value == null) return next()
  res.setHeader('x-sc-version', JSON.stringify(result.versions))
  res.setHeader('content-type', 'text/plain')
  res.send(value)
})

const server = http.createServer(app)

const wss = createWss(store, {server})

server.listen(2001)
console.log('http server listening on port 2001')
