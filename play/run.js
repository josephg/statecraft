//const hostSource = require('./hostsource')
const http = require('http')

const port = process.env.PORT || 5747
const root = require('./root')()

//http.createServer(hostSource(root)).listen(port)
//console.log(`root ${root.source} listening on ${port}`)

{
  const view = require('./view')(root, (x => -x))

  require('./server').tcpServer(view).listen(port, () => {
    console.log('listening on TCP port', port)
  })

  /*
  view.streamOps([['a', 'z']], null, (x => console.log('l', x)), (err, result) => {
    console.log('streaming', err, result)
  })*/
}



const router = require('./router')()

const remoteRoot = root//require('./client').tcpClient(5747, 'localhost')
router.mount(remoteRoot, '', ['a', 'b'], '')
router.mount(remoteRoot, '', ['a', 'a~'], 'yo/')
router.mount(remoteRoot, '', ['j', 'k~'], 'yo/')
router.mount(remoteRoot, '', ['a', 'q~'], 'zz/')

console.log(router.routes)


router.streamOps([['a', 'z']], null, (x => console.log('l', x)), (err, result) => {
  console.log('streaming', err, result)
})
