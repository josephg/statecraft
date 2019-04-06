import wsserver from './wsserver'
import wsclient from './wsclient'
import tcpserver from './tcpserver'
import tcpclient from './tcpclient'
import reconnectingclient from './reconnectingclient'
import WebSocket from 'ws'

import * as tinyStream from './tinystream'

export default {
  WebSocket, wsserver, tcpserver,

  wsclient, tcpclient,

  reconnectingclient,

  tinyStream,
}