import * as I from '../../lib/types/interfaces'
import lmdbStore from '../../lib/stores/lmdb'
import augment from '../../lib/augment'
import kvStore from '../../lib/stores/kvmem'
import mapStore from '../../lib/stores/map'
import router, {ALL} from '../../lib/stores/router'
import createWss from '../../lib/net/wsserver'

import render from './browserclient/render'
// import createHttp from '../net/httpserver'
import http = require('http')

import fs = require('fs')
import url = require('url')

import express = require('express')
import bodyParser = require('body-parser')
import jsesc = require('jsesc')

import mod = require('./rustpng')

process.on('unhandledRejection', err => { throw err })

// const store = augment(lmdbStore(

type BPWorld = {
  v: 2,
  offx: number,
  offy: number,
  img: string
}

const data = new Map<string, BPWorld>(
  fs.readFileSync('bp.json', 'utf8')
  .split('\n')
  .filter(x => x !== '')
  .map(data => JSON.parse(data))
  .map(([key, val]) => [key, val.data] as [string, BPWorld])
)
// console.log(data)

const rootStore = augment(kvStore(data, {source: 'rootstore'}))
const imgStore = mapStore(rootStore, (v, k) => {
  console.log('v', v)
  return Buffer.from(mod.convert(v.img, 8, 1, 2) as any)
})

const store = router()
store.mount(rootStore, 'world/', ALL, '', true)
store.mount(imgStore, 'img/', ALL, '', false)

// const s2 = augment(kvStore())
// s2.storeInfo.sources[0] = 's2'
// store.mount(s2, 's2/', ALL, '', true)

// const s3 = augment(kvStore())
// s3.storeInfo.sources[0] = 's3'
// // s3.storeInfo.sources.push(s2.storeInfo.sources[0])
// // s3.storeInfo.sources.push(imgStore.storeInfo.sources[0])
// store.mount(s3, 's3/', ALL, '', true)
// console.log(store.storeInfo.sources)

// store.subscribe({type: 'kv', q: new Set(['world/asdf', 'img/adf', 's3/asdf', 's2/sfd'])}, {})


const app = express()
app.use(express.static(`${__dirname}/public`))
app.use(bodyParser.json())


// TODO: Do all this work in another map() function.
app.get('*', async (req, res, next) => {
  // Try to answer request using a rendered statecraft store
  const key = url.parse(req.url).pathname!.slice(1)
  // console.log('key', key)
  const result = await store.fetch({type: 'kv', q: new Set([key])})
  // console.log('result', result)
  let value = result.results.get(key)
  if (value == null) return next()

  res.setHeader('content-type', 'text/html')
  res.setHeader('x-sc-version', JSON.stringify(result.versions))
  // TODO: generate an etag based off the version, and parse it back to pass to fetch.

  const versionRange = result.versions
  const versions: I.FullVersion = {}
  for (const s in versionRange) versions[s] = versionRange[s].to

  const mimetype = Buffer.isBuffer(value) ? 'image/png' : 'application/json'
  // if (Buffer.isBuffer(value)) value = value.toString('base64')
  if (Buffer.isBuffer(value)) value = `data:${mimetype};base64,${value.toString('base64')}`

  // const v = Buffer.isBuffer(value) ? value.toString('base64') : value
  res.send(`<!doctype html>
<div id=content>${render(mimetype, value).toString()}</div>
<script>
const Buffer = {from(arr) { return new Uint8Array(arr) }};
const config = ${jsesc({
  mimetype,
  key,
  initialValue: value,
  initialVersions: versions
} as any)}
</script>
<script src="/bundle.js"></script>
`)
})

app.get('/:user/:key.json', async (req, res, next) => {
  const {user, key} = req.params
  const k = `world/${user}/${key}`
  const result = await store.fetch({type: 'kv', q: new Set([k])})
  const value = result.results.get(k)
  if (value == null) return next()
  res.setHeader('x-sc-version', JSON.stringify(result.versions))
  res.setHeader('content-type', 'application/json')
  res.json({
    v: 0,
    data: value,
    readonly: false,
  })
})

app.put('/:user/:key.json', async (req, res, next) => {
  const {user, key} = req.params
  const txn = new Map([[`world/${user}/${key}`, {type:'set', data: req.body.data}]])
  const result = await store.mutate('resultmap', txn)
  console.log(result)
  res.end()
})

app.get('/:user/:key', (req, res) => {
  res.sendFile('public/editor.html', {root: __dirname})
})

const server = http.createServer(app)

const wss = createWss({server}, store)

server.listen(2000)
console.log('http server listening on port 2000')
