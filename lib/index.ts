import * as I from './types/interfaces'
import kvStore, {KVMemOptions} from './stores/kvmem'
import augment from './augment'

const createKVStore = (
  data: Map<I.Key, I.Val>,
  opts: KVMemOptions)
: I.Store => {
  const innerStore = kvStore(data, opts)
  const outerStore = augment(innerStore)
  outerStore.internalDidChange = innerStore.internalDidChange.bind(innerStore)
  return outerStore
}

export {createKVStore}