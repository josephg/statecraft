// Returns middleware wrapping a fetch function

const concat = require('concat-stream')

module.exports = (fetchfn, source) => (req, res) => {
  console.log(req.url, req.headers)

  const vs = [+req.headers['x-minversion'], +req.headers['x-maxversion']]
  // No error handling. Eh.
  req.pipe(concat(text => {
    ranges = JSON.parse(text)
    fetchfn(ranges, vs, (err, {results, versions:v2}) => {
      if (err) throw err

      res.setHeader('content-type', 'application/json')
      res.setHeader('x-minversion', v2[0])
      res.setHeader('x-maxversion', v2[1])
      if (source) res.setHeader('x-source', source)
      res.write(JSON.stringify(results))
      res.end()
    })
  }))
}
