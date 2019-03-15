import * as I from '../interfaces'
import * as N from './netmessages'
import {queryTypes} from '../qrtypes'

export const queryToNet = (q: I.Query | I.ReplaceQuery): N.NetQuery => {
  if (q.type === 'single' || q.type === 'allkv') return q.type
  else return [q.type, queryTypes[q.type].toJSON(q.q)]
}

export const queryFromNet = (nq: N.NetQuery): I.Query | I.ReplaceQuery => {
  if (typeof nq === 'string') return ({type: nq} as I.Query)
  else {
    const [qtype, data] = nq
    return {
      type: qtype,
      q: queryTypes[qtype].fromJSON(data)
    } as I.Query
  }
}

// I'd really much prefer to use base64 encoding here, but the browser doesn't
// have a usable base64 encoder and they aren't small.
// Msgpack handles this fine, but I also want it to work over JSON. Eh.. :/
export const versionToNet = (v: I.Version): N.NetVersion => Array.from(v)
export const versionFromNet = (v: N.NetVersion): I.Version => Uint8Array.from(v)

export const versionRangeToNet = ({from, to}: I.VersionRange): N.NetVersionRange => [versionToNet(from), versionToNet(to)]
export const versionRangeFromNet = (val: N.NetVersionRange): I.VersionRange => ({from: versionFromNet(val[0]), to: versionFromNet(val[1])})

export const fullVersionToNet = (vs: I.FullVersion): N.NetFullVersion => vs.map(v => v ? versionToNet(v) : null)
export const fullVersionFromNet = (nvs: N.NetFullVersion): I.FullVersion => nvs.map(nv => nv ? versionFromNet(nv) : null)

export const fullVersionRangeToNet = (vs: I.FullVersionRange): N.NetFullVersionRange => (
  vs.map(v => v ? versionRangeToNet(v) : null)
)
export const fullVersionRangeFromNet = (nvs: N.NetFullVersionRange): I.FullVersionRange => (
  nvs.map(nv => nv ? versionRangeFromNet(nv) : null)
)

