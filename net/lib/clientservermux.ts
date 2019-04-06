// This implements a mux server which symmetrically both exposes and consumes
// a store.
import {I} from '@statecraft/core'
import * as N from './netmessages'

import createStore from './client'
import serve from './server'

import {TinyReader, TinyWriter, onMsg} from './tinystream'

export type BothMsg = N.CSMsg | N.SCMsg

// Passes invariants inv(0) != 0, inv(inv(x)) == x.
const inv = (x: number) => -x-1

export default function connectMux<RemoteVal>(reader: TinyReader<BothMsg>, writer: TinyWriter<BothMsg>, localStore: I.Store<any>, symmetry: boolean): Promise<I.Store<RemoteVal>> {
  // To mux them both together I'm going to use the .ref property, which is on
  // all net messages except the hello message.

  // There's 4 streams going on here:
  // - Local store reader (c->s) / writer (s->c)
  // - Remote store reader (s->c) / writer (c->s)

  // One reader/writer pair will have all the .ref properties in messages
  // inverted based on symmetry property. If symmetry is true, we invert the
  // local store messages. If its false, we invert the remote store messages.

  const localReader = {} as TinyReader<N.CSMsg>
  localReader.buf = []

  // If either writer closes, we'll close the whole tunnel.
  const localWriter: TinyWriter<N.SCMsg> = {
    write(msg) {
      if (msg.a !== N.Action.Hello && symmetry) msg.ref = inv(msg.ref)
      writer.write(msg)
    },
    close() { writer.close() },
  }

  const remoteReader: TinyReader<N.SCMsg> = {buf: [], isClosed: false}
  const remoteWriter: TinyWriter<N.CSMsg> = {
    write(msg) {
      if (!symmetry) msg.ref = inv(msg.ref)
      writer.write(msg)
    },
    close() { writer.close() },
  }

  reader.onMessage = msg => {
    if (msg.a === N.Action.Hello) onMsg(remoteReader, msg)
    else {
      const neg = msg.ref < 0
      if (neg) msg.ref = inv(msg.ref)
      if (neg !== symmetry) onMsg(remoteReader, msg as N.SCMsg)
      else onMsg(localReader, msg as N.CSMsg)
    }
  }

  serve(localReader, localWriter, localStore)
  return createStore(remoteReader, remoteWriter)
}
