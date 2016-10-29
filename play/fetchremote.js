const request = require('request')
const assert = require('assert')

module.exports = (urlBase, ranges, vs, expectedSource, callback) => {
  request({
    method: 'GET',
    url: urlBase + '/fetch',
    headers: {
      'x-minversion': vs[0],
      'x-maxversion': vs[1],
      'x-source': expectedSource || undefined,
    },
    json: ranges
  }, (err, res) => {
    if (err) return callback(err)

    const results = res.body

    const v2 = [+res.headers['x-minversion'], +res.headers['x-maxversion']]
    const resultSource = res.headers['x-source']

    callback(null, {results, versions:v2, source:resultSource})
  })
}

