const request = require('request')
const assert = require('assert')

const accessToken = "5"

let knownVersions = {} // Map from source -> [v,v] range.
let knownData = {}

const fetch = require('./fetchremote')

// Set of pairs of key1, key2. Ranges inclusive for now.
const q = [['a', 'c'], ['j', 'm']]
fetch('http://localhost:5741', q, knownVersions, (err, data) => {
  if (err) throw err

  const {results, versions:v2} = data
  console.log('v', v2, 'results', results)

  /*
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
  }*/

  // Merge data.
  //
  // Soooo this actually needs to be more complicated. The problem is that we
  // have some results from a different version range. If the ranges are
  // non-overlapping then we have a problem and the old data needs to be
  // brought into a similar range.
  for(k in results) {
    knownData[k] = results[k]
  }
  // For now.
  knownVersions = v2

  console.log('known', knownData)
  console.log('version', knownVersions)

})
