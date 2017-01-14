//const hostSource = require('./hostsource')
const http = require('http')

const port = process.env.PORT || 5747
const root = require('./root')()

//http.createServer(hostSource(root)).listen(port)
//console.log(`root ${root.source} listening on ${port}`)


const view = require('./view')(root, (x => -x))

require('./server').tcpServer(view).listen(port, () => {
  console.log('listening on TCP port', port)
})

/*
view.streamOps([['a', 'z']], null, (x => console.log('l', x)), (err, result) => {
  console.log('streaming', err, result)
})*/




/*

const router = require('./router')()

const {Remote} = require('./remotesource')

const remoteRoot = root//Remote('http://localhost:5747')
router.mount(remoteRoot, '', ['a', 'a~'], 'yo/')
router.mount(remoteRoot, '', ['j', 'k~'], 'yo/')
router.mount(remoteRoot, '', ['a', 'q~'], 'zz/')

console.log(router.routes)


require('http').createServer(require('./hostsource')(router)).listen(5741)
console.log('listening on 5741')

*/
