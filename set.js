const makeStore = require('./dbroot')

if (process.argv.length < 4) throw Error('Usage: node set.js key val')

const [, , key, val] = process.argv
const store = makeStore('db')
store.mutate(new Map([[key, {type:'set', data:val}]]), {}, {}, (err, v) => {
  if (err) throw err
  console.log('Mutation accepted at version', v)
})
