// TODO: Naming??
const runTests = require('./common')
const {create, close} = require('./lmdb')

runTests(create, close)
