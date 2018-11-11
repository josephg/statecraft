// I'm not using proper streams because they add about 150k of crap to the browser
// bundle.

// This is the simplest possible API around a stream that we can use in server
// & client code.
import {Readable, Writable} from 'stream'

export interface TinyReader<Msg> {
  onmessage?: (msg: Msg) => void
}

export interface TinyWriter<Msg> {
  write(data: Msg): void,
  close(): void,
}

export const wrapReader = <Msg>(r: Readable) => {
  const reader: TinyReader<Msg> = {}

  r.on('data', msg => {
    reader.onmessage!(msg as any as Msg)
  })
  
  return reader
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
