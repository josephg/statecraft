import * as I from '../interfaces'
import {TinyReader, TinyWriter} from '../net/tinystream'
import * as N from '../net/netmessages'
import storeFromStreams from '../net/client'
import singleMem from './singlemem'

const reconnector = (connect: (() => [TinyReader<N.SCMsg>, TinyWriter<N.CSMsg>])): [I.SimpleStore, Promise<I.Store>] => {
  const status = singleMem({connected: false})

  const [reader, writer] = connect()
  return [status, storeFromStreams(reader, writer)]
}