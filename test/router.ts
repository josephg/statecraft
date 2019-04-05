import 'mocha'
import kvmem from '../lib/stores/kvmem'
import router, {ALL} from '../lib/stores/router'
import runTests from './common'

describe('router', () => {
  runTests(async () => {
    const root = await kvmem()
    const store = router()

    // This is really dumb - we're just mounting it all the way through.
    store.mount(root, '', ALL, '', true)
  
    // TODO: Also run all the tests with a double-mounted store
    // TODO: Also run all the tests via a split read / writer.
    return store
  })

  it('contains sources of all mounted stores')
  it('maps keys in fetch both ways')
  it('groups subscriptions based on the sources')

  describe('getops', () => {
    // Example inputs:
    // [[source:x, v:1]] => [source:x, v:1]
    // [[source:x, v:1], [source:y, v:1]] => [{source:x, v:1}, {source:y, v:1}]
    // [[v:{x:1, y:2}], [v:{y:1}]] => [{v:{y:1}}, {v:{x:1, y:2}}]
    // [[v:{x:1, y:1}], [v:{y:2}]] => [{v:{x:1, y:1}}, {v:{y:2}}]
    // [[v:{x:1}], [v:{x:1}]] => [v:{x:1}] with ops merged
    // ... And variations.
  })
})
