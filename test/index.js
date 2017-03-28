// TODO: Naming??
const runTests = require('./common')
const {create, close} = require('./lmdb')

describe('raw local database', () => runTests(create, close))

const serverForSource = new WeakMap

describe('remote database endpoints', () => {
  runTests((callback) => {
    const root = create()
    // ... And wrap it in a server.
    const server = require('../lib/tcpserver').tcpServer(root)
    // Could use a socket here instead, but this is fine too.
    server.listen(() => {
      const port = server.address().port
      require('../lib/tcpclient').tcpClient(port, 'localhost', (err, source) => {
        if (source) serverForSource.set(source, server)
        return callback(err, source)
      })
    })
  }, (source) => {
    // Close server
    serverForSource.get(source).close()

  })
})
