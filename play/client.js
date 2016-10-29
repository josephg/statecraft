const request = require('request')
const assert = require('assert')

const accessToken = "5"
let minVersion = 0
let source = null

let knownData = {}

const fetch = require('./fetchremote')

// Set of pairs of key1, key2. Ranges inclusive for now.
const q = [['a', 'c'], ['j', 'm']]
fetch('http://localhost:5741', q, [minVersion, Infinity], source, (err, data) => {
  if (err) throw err

  const {results, versions:v2, source:resultSource} = data
  console.log('v', v2, 'results', results)
  console.log('root source', resultSource)
  if (source && resultSource && resultSource !== source) {
    console.log('Discarding all I know about the world - the DB has changed!')
    knownData = {}
    minVersion = v2[0]
  } else if (!source) {
    source = resultSource
    minVersion = v2[0]
  } else {
    assert(v2[1] >= minVersion)
    minVersion = Math.max(v2[0], minVersion)
  }
  // Merge data
  for(k in results) {
    knownData[k] = results[k]
  }

  console.log('known', knownData)
  console.log('version', minVersion)

  minVersion = v2[0]

})
