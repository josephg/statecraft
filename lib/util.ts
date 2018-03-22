import * as I from './types/interfaces'

function doNothing() {}
export function genCursorAll(sub: I.Subscription) {
  // const cursorAll: ((opts: I.SubscribeOpts, callback?: I.SubCursorCallback) => void)
  //   | ((callback?: I.SubCursorCallback) => void)
  function cursorAll(opts: I.SubscribeOpts, callback?: I.SubCursorCallback): void;
  function cursorAll(callback?: I.SubCursorCallback): void;

  function cursorAll(_opts: any, _callback?: any) {
    const [opts, callback]: [I.SubscribeOpts, I.SubCursorCallback]
      = typeof _opts === 'function' ? [{}, _opts || doNothing] : [_opts || {}, _callback || doNothing]

    // if (this.isComplete()) return callback()
    sub.cursorNext(opts, (err, result) => {
      if (err) return callback(err)
      else if (sub.isComplete()) return callback(null, result)
      else cursorAll(opts, callback)
    })
  }

  return cursorAll
}
