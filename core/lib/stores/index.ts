import opmem from './opmem'
import kvmem from './kvmem'
import singlemem from './singlemem'

import ot from './ot'
import map from './map'
import onekey from './onekey'
import readonly from './readonly'
import router from './router'
import splitwrites from './splitwrites'

import poll from './poll'

export default {
  opmem, kvmem, singlemem,
  
  // TODO: These should probably beCapitalizedLikeThis.
  ot, map, onekey, readonly, router, splitwrites,

  poll,
}