
declare module 'errno' {
  let custom: {
    createError(name: string, parent?: ErrorConstructor): ErrorConstructor
  }
}

declare module 'msgpack-lite' {
  import {Duplex} from 'stream'

  interface Codec {}

  function encode(data: any, opts?: {codec?: Codec}): NodeBuffer
  function decode(buf: NodeBuffer, opts?: {codec?: Codec}): any

  function createCodec(opts: object): Codec

  // This is a hack to expose out the encoder.flush() function, which is needed because of
  // https://github.com/kawanet/msgpack-lite/issues/80
  interface DuplexPlus extends Duplex {
    encoder: { flush(): void }
  }
  function createEncodeStream(): DuplexPlus
  function createDecodeStream(): Duplex
}

declare module 'node-lmdb' {
  interface Database {
    close(): void
  }

  type Key = NodeBuffer | string | number

  interface Txn {
    getString(dbi: Database, key: Key): string
    getStringUmsafe(dbi: Database, key: Key): string
    getBinary(dbi: Database, key: Key): NodeBuffer
    getBinaryUnsafe(dbi: Database, key: Key): NodeBuffer
    getNumber(dbi: Database, key: Key): number
    getBoolean(dbi: Database, key: Key): boolean

    putBinary(dbi: Database, key: Key, val: NodeBuffer): void
    putString(dbi: Database, key: Key, val: string): void
    putString(dbi: Database, key: Key, val: number): void
    putString(dbi: Database, key: Key, val: boolean): void

    del(dbi: Database, key: Key): void
    abort(): void
    commit(): void
  }

  class Env {
    open(opts: {
      path?: string,
      maxDbs?: number,
      noTls?: boolean,
    }): void

    openDbi(opts: {
      name: string | null,
      create?: boolean,
    }): Database

    beginTxn(opts?: {readOnly?: boolean}): Txn
    close(): void
  }

  class Cursor {
    constructor(txn: Txn, dbi: Database)

    goToFirst(): Key | null
    goToLast(): Key | null
    goToKey(k: Key): Key | null // Go to k. Returns null if not found.
    goToRange(k: Key): Key | null // Go to the next key >= k.
    goToNext(): Key | null
    goToPrev(): Key | null

    getCurrentString(): string
    getCurrentNumber(): number
    getCurrentBoolean(): boolean
    getCurrentBinary(): Buffer

    // Valid only until next put() or txn closed.
    getCurrentStringUnsafe(): string
    getCurrentBinaryUnsafe(): Buffer

    // Weirdly no put methods.
    del(): void

    close(): void
  }
}