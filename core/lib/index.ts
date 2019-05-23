import * as I from './interfaces'
import stores from './stores'
import err, {errFromJSON, errToJSON, ErrJson} from './err'

import otDoc from './otdoc'
import genSource from './gensource'
import {getSingle, setSingle, getKV, rmKV, setKV} from './simple'
import sel from './sel'
import * as version from './version'
import subValues, {catchupStateMachine, subResults} from './subvalues'

import transaction from './transaction'

import {register as registerType, supportedTypes, typeOrThrow} from './typeregistry'
import {queryTypes, resultTypes, wrapQuery} from './qrtypes'
import {bitHas, bitSet} from './bit'

import makeSubGroup from './subgroup'

export {
  I, // TODO: Its weird exposing this as types.
  stores,
  catchupStateMachine, subValues, subResults,
  err, errFromJSON, errToJSON, ErrJson,
  genSource,
  otDoc,

  getSingle, setSingle, getKV, rmKV, setKV,
  sel,
  version,

  registerType, supportedTypes, typeOrThrow,
  queryTypes, resultTypes, wrapQuery,

  transaction,
  makeSubGroup,

  bitSet, bitHas,
}