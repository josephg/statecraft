// Common API for interacting with queries
import {type as kv} from './setops'
import {QueryOps} from './type'

const registry: {[name: string]: QueryOps<Set<any>, any>} = {
  kv
}
export {registry}
