import {connect} from '../../lib/stores/wsclient'
import singleMem, {setSingle} from '../../lib/stores/singlemem'
import augment from '../../lib/augment'
import connectMux, { BothMsg } from '../../lib/net/clientservermux'
import subValues from '../../lib/subvalues'

const wsurl = `ws${window.location.protocol.slice(4)}//${window.location.host}/ws`

type Pos = {x: number, y: number}
type DbVal = {[id: string]: Pos}

let data = new Map<string, Pos>()

// The local store that holds our mouse location
const localStore = augment(singleMem<Pos>({x:0, y:0}))

const canvas = document.getElementsByTagName('canvas')[0]
let ctx: CanvasRenderingContext2D

const resize = () => {
  canvas.width = canvas.clientWidth
  canvas.height = canvas.clientHeight
  ctx = canvas.getContext('2d', {alpha: false})!
  draw()
}
resize()

const colors = ['red', 'green', 'blue', 'white', 'purple', 'yellow', 'orange']

function draw() {
  ctx.fillStyle = 'black'
  // ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  ctx.fillStyle = 'red'
  for (const [id, {x, y}] of data) {
    ctx.fillStyle = colors[parseInt(id) % colors.length]
    ctx.fillRect(x-5, y-5, 10, 10)
  }
}

;(async () => {
  const [reader, writer] = await connect<BothMsg, BothMsg>(wsurl)
  const remoteStore = await connectMux<DbVal>(reader, writer, localStore, true)

  document.body.onmousemove = e => {
    // console.log('setting', e.clientX)
    setSingle(localStore, {x: e.clientX, y: e.clientY})
  }

  const sub = remoteStore.subscribe({type: 'allkv', q:true})
  for await (const d of subValues('kv', sub)) {
    // console.log('d', d)
    data = d
    draw()
  }
})()

