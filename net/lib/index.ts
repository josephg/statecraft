import wsserver from './wsserver'
import wsclient, {connect as connectToWS} from './wsclient'
import tcpserver from './tcpserver'
import tcpclient, {connectToSocket, createStreams as createTCPStreams} from './tcpclient'
import reconnectingclient from './reconnectingclient'
import WebSocket from 'ws'

import * as tinyStream from './tinystream'

export {
  WebSocket, wsserver, tcpserver,

  wsclient, connectToWS,
  tcpclient, connectToSocket, createTCPStreams,

  reconnectingclient,

  tinyStream,
}