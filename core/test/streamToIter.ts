/*

import streamToIter from './lib/streamToIter'

const stream = streamToIter<number>(() => {
  console.log('cancelled')
})

;(async () => {
  try {
    for await (const elem of stream.iter) {
      console.log('read element', elem)
    }
    console.log('for await completed')
  } catch (e) {
    console.log('error iterating', e)
  }

})()

stream.append(3)
stream.append(4)

// Should cancel, then say 'error iterating'
stream.throw(Error('omg'))

// 3, 4, completed & cancelled.
//stream.end()

// 
//stream.iter.return()

*/