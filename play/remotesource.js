
// A source has:
// - Fetch
// - Subscribe
// - Update
// - ???

const request = require('request')
const assert = require('assert')

exports.Remote = (urlBase) => {

  return {
    fetch(ranges, v1, callback) {
      request({
        method: 'GET',
        url: urlBase + '/fetch',
        json: {ranges, versons:v1}
      }, (err, res) => {
        if (err) return callback(err)

        // {ranges, versions}.
        callback(null, res.body)
      })
    },
  }
}


