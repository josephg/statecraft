import * as I from './types/interfaces'
import kvStore from './stores/kvmem'
import augment from './augment'

const createKVStore = (
  data: Map<I.Key, I.Val>,
  source: I.Source,
  initialVersion: I.Version)
: I.Store => augment(kvStore())

export {createKVStore}