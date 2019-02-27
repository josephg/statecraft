import {connect} from '../../lib/stores/wsclient'
import singleMem, {setSingle} from '../../lib/stores/singlemem'
import augment from '../../lib/augment'
import connectMux from '../../lib/net/clientservermux'
import subValues from '../../lib/subvalues'

const wsurl = `ws${window.location.protocol.slice(4)}//${window.location.host}/ws`

let data: any = {}
const store = augment(singleMem(0))

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
  let i = 0
  for (const id in data) {
    const {x, y} = data[id]
    ctx.fillStyle = colors[(i++) % colors.length]
    ctx.fillRect(x-5, y-5, 10, 10)
  }
}

;(async () => {
  const [reader, writer] = await connect(wsurl)
  const remoteStore = await connectMux(reader, writer, store, true)

  document.body.onmousemove = e => {
    // console.log('setting', e.clientX)
    setSingle(store, {x: e.clientX, y: e.clientY})
  }

  const sub = remoteStore.subscribe({type: 'single', q:true})
  for await (const d of subValues('single', sub)) {
    // console.log('d', d)
    data = d
    draw()
  }
})()

