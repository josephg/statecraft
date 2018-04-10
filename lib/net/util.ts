import * as I from '../types/interfaces'
import * as N from './netmessages'
import {
  queryTypes, snapToJSON, snapFromJSON, getQueryData
} from '../types/queryops'

export const queryToNet = (q: I.Query): N.NetQuery => {
  if (q.type === 'single' || q.type === 'allkv') return q.type
  else {
    const qtype = queryTypes[q.type].q
    return [q.type, snapToJSON(qtype, getQueryData(q))]
  }
}

export const queryFromNet = (nq: N.NetQuery): I.Query => {
  if (typeof nq === 'string') return ({type: nq} as I.Query)
  else {
    const [qtype, data] = nq
    const type = queryTypes[qtype]
    return {
      type: qtype,
      q: snapFromJSON(type.q, data)
    } as I.Query
  }
}
