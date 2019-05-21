import wsserver, {wrapWebSocket} from './wsserver'
import wsclient, {connect as connectToWS} from './wsclient'
import tcpserver, {serveToSocket} from './tcpserver'
import tcpclient, {connectToSocket, createStreams as createTCPStreams} from './tcpclient'
import reconnectingclient from './reconnectingclient'
import connectMux, {BothMsg} from './clientservermux'
import WebSocket from 'ws'

import * as tinyStream from './tinystream'

export {
  WebSocket, wsserver, wrapWebSocket,
  tcpserver, serveToSocket,

  wsclient, connectToWS,
  tcpclient, connectToSocket, createTCPStreams,

  reconnectingclient,

  connectMux, BothMsg,

  tinyStream,
}