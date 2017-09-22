import * as I from './types/interfaces'
import {randomBytes} from 'crypto'

export function genSource() {
  const sourceBytes = randomBytes(12)
  return sourceBytes.toString('base64')
}

function doNothing() {}
export function genCursorAll(sub: I.Subscription) {
  const cursorAll = (opts: I.SubscribeOpts = {}, callback: I.Callback<{
    activeQuery: any,
    activeVersions: I.FullVersionRange,
  }> = doNothing) => {
    // if (this.isComplete()) return callback()
    sub.cursorNext(opts, (err, result) => {
      if (err) return callback(err)
      else if (sub.isComplete()) return callback(null, result)
      else cursorAll(opts, callback)
    })
  }

  return cursorAll
}
