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
