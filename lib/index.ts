import * as I from './interfaces'
import stores from './stores'
import net from './net'
import WebSocket from 'ws'

import * as kv from './kv'

export default {
  types: I,
  stores,
  net,
  kv,
}