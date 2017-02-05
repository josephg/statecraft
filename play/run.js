//const hostSource = require('./hostsource')
const http = require('http')

const port = process.env.PORT || 5747
const root = require('./root')()

//http.createServer(hostSource(root)).listen(port)
//console.log(`root ${root.source} listening on ${port}`)

{
  const view = require('./view')(root, (x => -x))

  require('./tcpserver').tcpServer(view).listen(port, () => {
    console.log('listening on TCP port', port)
  })

  /*
  view.streamOps([['a', 'z']], null, (x => console.log('l', x)), (err, result) => {
    console.log('streaming', err, result)
  })*/
}



const router = require('./router')()

const remoteRoot = root//require('./tcpclient').tcpClient(5747, 'localhost')
router.mount(remoteRoot, '', ['a', 'b'], '')
router.mount(remoteRoot, '', ['a', 'a~'], 'yo/')
router.mount(remoteRoot, '', ['j', 'k~'], 'yo/')
router.mount(remoteRoot, '', ['a', 'q~'], 'zz/')

//console.log('routes', router.routes)



root.simpleSubKV(['a', 'b'], null, (x => console.log('l', x)), (err, result) => {
  console.log('streaming', err, result)
})


root.fetchKV(['a', 'b', 'c'], {}, (err, results) => {
  console.log(err, results)
})


const sub = root.subscribeKV(['a', 'b', 'c'/*, 'f', 'g', 'h', 'j', 'k'*/], {}, {notifyAll:true})
//sub.stream.on('data', val => console.log(val, stream.data))

sub.on('ready', data => {
  console.log('ready', data)
})
sub.on('txn', (data, v) => {
  console.log('txn', data, v)

  console.log(sub.data, sub.versions)
})

setTimeout(() => {
  console.log('modifying subscription')
  sub.modify({remove:['a'], add:['z']}, (err, newData) => {
    console.log('subscription modified', newData)
  })
}, 3000)
