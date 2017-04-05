// Utility methods to mix in to subscriptions.

module.exports = sub => {
  sub.cursorAll = function(opts = {}, callback) {
    if (typeof opts === 'function') [opts, callback] = [{}, opts]

    if (sub.isComplete()) return callback()
    else sub.cursorNext(opts, err => {
      if (err) return callback(err)
      sub.cursorAll(opts, callback)
    })
  }

  return sub
}

