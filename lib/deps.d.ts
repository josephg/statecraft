
declare module 'errno' {
  let custom: {
    createError(name: string, parent?: ErrorConstructor): ErrorConstructor
  }
}

declare module 'msgpack-lite' {
  interface Codec {}

  function encode(data: any, opts?: {codec?: Codec}): NodeBuffer
  function decode(buf: NodeBuffer, opts?: {codec?: Codec}): any

  function createCodec(opts: object): Codec
}