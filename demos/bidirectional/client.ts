import * as I from '../../lib/interfaces'
import {connect} from '../../lib/stores/wsclient'
import singleMem, {setSingle} from '../../lib/stores/singlemem'
import connectMux, { BothMsg } from '../../lib/net/clientservermux'
import subValues from '../../lib/subvalues'

const wsurl = `ws${window.location.protocol.slice(4)}//${window.location.host}/ws`

type Pos = {
  x: number,
  y: number,
  gamepad?: {
    id: string,
    buttons: number[],
    axes: readonly number[],
  }
}
type DbVal = {[id: string]: Pos}

let data = new Map<string, Pos>()

// The local store that holds our mouse location
const localStore = singleMem<Pos>({x:0, y:0})

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

let lastTS: number = -1
let mouse: Pos = {x:0, y:0}
const pollGamepads = () => {
  const gamepads = navigator.getGamepads()
  const g = gamepads[0]
  if (g == null) {
    return
  }

  console.log(g.timestamp)
  if (lastTS != g.timestamp) {
    mouse.gamepad = {
      id: g.id,
      buttons: g.buttons.map(b => b.value),
      axes: g.axes,
    }

    setSingle(localStore, mouse)
    lastTS = g.timestamp
  }

  setTimeout(pollGamepads, 16)
  // requestAnimationFrame(pollGamepads)
}

window.addEventListener("gamepadconnected", e => {
  console.log('gamepad connected')
  pollGamepads()
  // requestAnimationFrame(pollGamepads)
})


;(async () => {
  const [reader, writer] = await connect<BothMsg, BothMsg>(wsurl)
  const remoteStore = await connectMux<DbVal>(reader, writer, localStore, true)

  document.body.onmousemove = e => {
    // console.log('setting', e.clientX)
    // mouse = {x: e.clientX, y: e.clientY}
    mouse.x = e.clientX; mouse.y = e.clientY
    setSingle(localStore, mouse)
  }

  const sub = remoteStore.subscribe({type: I.QueryType.AllKV, q:true})
  for await (const d of subValues(I.ResultType.KV, sub)) {
    // console.log('d', d)
    data = d
    draw()
  }
})()

