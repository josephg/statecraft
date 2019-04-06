// I'm not using node streams because they add about 150k of crap to the browser
// bundle.

// This is the simplest possible API around a stream that we can use in server
// & client code.

// TODO: Consider using streamToIter here, which we're already pulling in to
// the client anyway.
import {Readable, Writable} from 'stream'

export interface TinyReader<Msg> {
  buf: Msg[] // For messages before onmessage has been set
  onMessage?: (msg: Msg) => void
  onClose?: () => void
  isClosed: boolean,
}

export interface TinyWriter<Msg> {
  write(data: Msg): void,
  close(): void,
}

export const wrapReader = <Msg>(r: Readable) => {
  const reader: TinyReader<Msg> = {buf: [], isClosed: false}

  r.on('data', msg => {
    if (reader.onMessage) reader.onMessage!(msg as any as Msg)
    else reader.buf.push(msg)
  })
  r.on('end', () => {
    reader.isClosed = true
    if (reader.onClose) reader.onClose()
  })
  r.on('error', err => {
    // I think this'll hit end right afterwards, so we don't have to do
    // anything here. I think.
    console.warn('socket error', err)
  })
  
  return reader
}

export const listen = <Msg>(r: TinyReader<Msg>, listener: (msg: Msg) => void) => {
  r.buf.forEach(listener)
  r.buf.length = 0
  r.onMessage = listener
}
export const onMsg = <Msg>(r: TinyReader<Msg>, msg: Msg) => {
  if (r.onMessage) r.onMessage(msg)
  else r.buf.push(msg)
}

export const wrapWriter = <Msg>(w: Writable, encode?: (msg: Msg) => any) => {
  return {
    write(data) {
      if (w.writable) {
        w.write(encode ? encode(data) : data)

        // Work around this bug:
        // https://github.com/kawanet/msgpack-lite/issues/80
        if ((w as any).encoder) (w as any).encoder.flush()
      }
    },
    close() {
      w.end()
    }
  } as TinyWriter<Msg>
}
