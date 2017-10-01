
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

declare module 'node-lmdb' {
  interface Database {
    close(): void
  }

  type Key = NodeBuffer | string | number

  interface Txn {
    getString(dbi: Database, key: Key): string
    getBinary(dbi: Database, key: Key): NodeBuffer
    getNumber(dbi: Database, key: Key): number
    getBoolean(dbi: Database, key: Key): boolean

    putBinary(dbi: Database, key: Key, val: NodeBuffer): void
    putString(dbi: Database, key: Key, val: String): void
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
}