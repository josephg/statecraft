import * as I from '../types/interfaces'
import err from '../err'

const nullstore: I.Store = {
  // We don't need a source; we have no data.
  //
  // It might make sense to add a dummy hard-coded source name here - not sure.
  sources: [],

  capabilities: {
    queryTypes: new Set(),
    mutationTypes: new Set(),
  },

  fetch(qtype, query, opts, callback) {
    callback(new err.UnsupportedTypeError('null store does not support querying'))
  },

  mutate(mtype, txn, versions, opts, callback) {
    callback(new err.UnsupportedTypeError('null store does not support mutation'))
  },

  getOps(qtype, query, versions, opts, callback) {
    // TODO: Alternate: Return empty getOps result.
    callback(new err.UnsupportedTypeError('null store does not support operations'))
  },

  subscribe() {
    throw new err.UnsupportedTypeError('null store does not support subscriptions')
  },

  close() {},
}

export default nullstore