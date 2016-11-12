const request = require('request')
const assert = require('assert')

module.exports = (urlBase, ranges, v1, callback) => {
  request({
    method: 'GET',
    url: urlBase + '/fetch',
    json: {ranges, versons:v1}
  }, (err, res) => {
    if (err) return callback(err)

    // {ranges, versions}.
    callback(null, res.body)
  })
}

