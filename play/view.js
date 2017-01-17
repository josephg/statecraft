// This is a silly implementation of a couchdb-style view.
//
// We'll consume a source and pass it through a (syncronous) function. You
// could totally write an async version of this but it'd be way more
// complicated.
//
// We'll optionally map the ranges through a backend & frontend prefix for
// convenience. Set view.bPrefix / view.fPrefix. (Which should move to
// configuration when I get that sorted)

const assert = require('assert')
const {mapKey, mapRange} = require('./util')

class View {
  constructor(source, fn) {
    assert(source)
    assert(fn)
    this.source = source
    this.mapfn = fn
    this.bPrefix = this.fPrefix = ''
  }

  getBRanges(fRanges) {
    return fRanges.map(r => mapRange(r, this.fPrefix, this.bPrefix))
  }

  fetch(fRanges, versions, callback) {
    const bRanges = this.getBRanges(fRanges)
    this.source.fetch(bRanges, versions, (err, data) => {
      if (err) return callback(err)

      const {results: bResults, versions} = data

      const fResults = {}
      for (let bk in bResults) {
        const fk = mapKey(bk, this.fPrefix, this.bPrefix)
        fResults[fk] = this.mapfn(bResults[bk])
      }

      callback(null, {results: fResults, versions})
    })
  }

  streamOps(fRanges, versions, listener, callback) {
    const bRanges = this.getBRanges(fRanges)

    const _listener = (bTxn) => {
      // Data is a map until the last entry, then its null to say its ended.
      if (bTxn == null) return listener(null)
      const {ops: bOps, versions} = bTxn

      const fOps = new Map
      for (let [bk, {newVal}] of bOps) {
        const fk = mapKey(bk, this.fPrefix, this.bPrefix)
        fOps.set(fk, {newVal: this.mapfn(newVal), opType: 'replace'})
      }

      listener({ops: fOps, versions})
    }

    this.source.streamOps(bRanges, versions, _listener, (err, stream) => {
      if (err) return callback(err)

      callback(null, {versions: stream.versions, cancel: () => stream.cancel()})
    })
  }
}

module.exports = (source, fn) => new View(source, fn)

