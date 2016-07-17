#const store = module.exports = store();

# store.getRaw(path) => Promise({data, type, metadata}) ?
# store.get('/foo/bar/baz') => Promise
# store.getType(path) => Promise

# store.set(path, value) => Promise

# fn called with (newvalue, v, opdata).
# Called immediately with opdata null and current value.
# store.watch(path, fn)
# store.deleteWatch(path, fn)

# types are binary, json, ..?
# store.setType(pathstem, type)

# store.at('/foo/bar/:baz', 
#store.view('/worlds/:id', '/worlds/:id/image', ...
# store.view('/worlds/:id', '/worldimg/:id', (world) => {...})

memdown = require 'memdown'
assert = require 'assert'
fs = require 'fs-extra'
statecraft = require '.'

describe 'store', ->
  beforeEach ->
    memdown.clearGlobalStore()
    @store = statecraft 'testdb', db:memdown

  describe 'set get', ->
    it 'can roundtrip values', (done) ->
      @store.set '/foo', {x:5}, (err) =>
        throw err if err
        @store.get '/foo', (err, data, v) =>
          assert.equal v, 1
          assert.deepEqual data, {x:5}
          done()


