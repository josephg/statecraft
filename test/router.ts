import 'mocha'

describe('router', () => {
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