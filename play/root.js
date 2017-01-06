const concat = require('concat-stream')

const db = {}
let v = 0

const source = require('crypto').randomBytes(12).toString('base64')
const alphabet = "abcdefghijklmnopqrstuvwxyz"
const gen = () => {
  const char = alphabet[(Math.random() * alphabet.length)|0]

  // Transaction!
  v++
  let cell = db[char]
  if (cell == null) {
    db[char] = {data:1, lastMod:v}
  } else {
    cell.data++
    cell.lastMod = v
  }
  // Transaction ended!


  //console.log(db)
}

for (let i = 0; i < 100; i++) gen()
setInterval(gen, 300)


function fetch(ranges, versions, callback) {
  const vrange = versions[source] || [0, Infinity]

  if (vrange[0] > v) {
    // TODO: Hold the query until the version catches up
    return callback(Error('Version in the future'))
  }

  const results = {}
  let minVersion = -1

  console.log('fetch', ranges, vrange)

  // Start read transaction
  ranges.forEach(([a, b]) => {
    //console.log('range', a, b)
    // Range query from a to b. But we know they're all single letters, so whatevs.
    const aa = a.charCodeAt(0)
    const bb = b.charCodeAt(0)

    for (let i = aa; i <= bb; i++) {
      const c = String.fromCharCode(i)
      const cell = db[c]
      if (!cell) continue
      //console.log('got cell', c, cell)
      minVersion = Math.max(minVersion, cell.lastMod)
      results[c] = cell.data
    }
  })

  callback(null, {results, versions:{[source]: [minVersion, v]}})
}


const port = process.env.PORT || 5747
require('http').createServer(require('./hostsource')({fetch})).listen(port)
console.log(`Source ${source} listening on ${port}`)
