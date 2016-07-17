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
statecraft = require '.'

throwErr = (fn) -> (err, vals...) ->
  throw err if err
  fn vals...

describe 'store', ->
  beforeEach ->
    memdown.clearGlobalStore()
    @store = statecraft 'testdb', db:memdown

  describe 'set get', ->
    it 'can roundtrip json values', (done) ->
      @store.set '/foo', {x:5}, throwErr =>
        @store.get '/foo', throwErr (data, v) =>
          assert.equal v, 1
          assert.deepEqual data, {x:5}
          done()

    it 'can roundtrip binary values', (done) ->
      buf = new Buffer [1,2,3]
      @store.set '/foo', buf, throwErr =>
        @store.get '/foo', throwErr (data, v) =>
          assert.equal v, 1
          assert.deepEqual data, buf
          done()

    it 'bumps the version on each set()', (done) ->
      @store.getVersion throwErr (v) =>
        assert.equal v, 0
        @store.set '/foo', {x:5}, throwErr =>
          @store.getVersion throwErr (v) =>
            assert.equal v, 1
            @store.set '/foo', {x:5}, throwErr =>
              @store.getVersion throwErr (v) =>
                assert.equal v, 2
                done()
  
    it 'can edit an existing value', (done) ->
      @store.set '/foo', {x:5}, throwErr =>
        @store.set '/foo', {x:6}, throwErr =>
          @store.get '/foo', throwErr (data, v) =>
            assert.equal v, 2
            assert.deepEqual data, {x:6}
            done()

    it 'returns the correct version to get()'

    it 'requires all paths to start with /'

    describe 'transactions', ->
      it 'accepts simple transactions'
      it 'fails a transaction if a specified conflict value is newer'
      it 'allows writing without conflicting'
      it 'allows marking read conflicts on separate values'
      it 'supports empty transactions' # Do we actually bump the version though?
    

  describe 'level compatibility', ->
    it 'successfully runs the leveldown compatibility test suite'
  
  describe 'sync protocol', ->
    it 'lets you start a sync with no version -> get whole database'
    it 'works if you edit the database while a sync is in progress'
    

  describe 'watch', ->
    it 'lets you watch globally'
    it 'lets you watch a single key'
    it 'lets you watch a path'

  describe 'views', ->
    it 'allows pure programatic views'
    it 'allows views over a part of the keyspace'
    it 'allows caching of views'

  describe 'mounting', ->
    it 'lets you roundtrip queries through a database mounted at a path'
    it.skip 'updates the index syncronously with the data', () ->
      # watch, then edit an indexed value. Watch should only have one update containing both the data and the index getting updated.



