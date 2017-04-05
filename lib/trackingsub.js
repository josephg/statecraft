// This wraps a store's subscription function to return subscriptions which
// also track the returned data and versions for a nicer, easier API.
//
// Tracked subscriptions have .data and .versions properties.
//
// TODO: Consider making them event listeners as well.

const resultset = require('./resultset')

module.exports = subscribe => {
  return (qtype, initialQuery, versions, opts = {}, outerListener) => {
    if (opts.supportedTypes) {
      // Trim to the types known by resultset
      for (let t of opts.supportedTypes) if (!resultset.supportedTypes.has(t)) {
        // We don't support the type, so strip it out of the requested type set.
        console.warn(`Removing requested op type ${t} - not supported out of raw mode`)
        opts.supportedTypes.delete(t)
      }
    } else {
      opts.supportedTypes = Array.from(resultset.supportedTypes)
    }

    let sub

    const listener = (type, update, versionUpdate) => {
      resultset.type.applyMut(sub.data, update)
      for (const s in versionUpdate) sub.versions[s] = versionUpdate[s]

      outerListener(type, update, versionUpdate)
    }

    sub = subscribe(qtype, initialQuery, versions, opts, listener)
    sub.data = new Map
    sub.versions = {
      // TODO: Let the store initialize these
      _query:[0,0], _cursor:[0,0],
    }

    return sub
  }
}
