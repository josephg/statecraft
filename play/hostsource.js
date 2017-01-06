// Returns middleware wrapping a fetch function

const concat = require('concat-stream')

module.exports = (source) => (req, res, next) => {
  console.log(req.url, req.headers)

  // No error handling. Eh.
  req.pipe(concat(text => {
    // Ranges is a list of [start, end] pairs.
    const {ranges, versions:v1} = JSON.parse(text)
    source.fetch(ranges, v1 || {}, (err, {results, versions:v2}) => {
      if (err) throw err

      res.setHeader('content-type', 'application/json')
      res.write(JSON.stringify({results, versions:v2}))
      res.end()
    })
  }))
}
