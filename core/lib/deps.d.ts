
declare module 'node-lmdb' {
  interface Database {
    close(): void
  }

  type Key = Buffer | string | number

  interface Txn {
    getString(dbi: Database, key: Key): string
    getStringUmsafe(dbi: Database, key: Key): string
    getBinary(dbi: Database, key: Key): Buffer
    getBinaryUnsafe(dbi: Database, key: Key): Buffer
    getNumber(dbi: Database, key: Key): number
    getBoolean(dbi: Database, key: Key): boolean

    putBinary(dbi: Database, key: Key, val: Buffer): void
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

declare module 'ot-text' {
  type TextOpComponent = number | string | {d: number}
  type TextOp = TextOpComponent[]

  let type: {
    name: string
    uri: string

    create(): string

    normalize(op: TextOp): TextOp
    apply(doc: string, op: TextOp): string
    transform(op: TextOp, other: TextOp, side: 'left' | 'right'): TextOp
    compose(a: TextOp, b: TextOp): TextOp
  }
}

declare module 'set2' {
  class Set2<V1, V2> implements Iterable<[V1, V2]> {
    size: number
    constructor(items?: [V1, V2][])
    subset(v1: V1): Set<V2>
    has(v1: V1, v2: V2): boolean
    add(v1: V1, v2: V2): void
    delete(v1: V1, v2: V2): void
    deleteAll(v1: V1): void
    clear(): void
    forEach(fn: (v1: V1, v2: V2) => void): void
    values(): Iterator<[V1, V2]>
    entries(): Iterator<[V1, V2]>
    [Symbol.iterator](): Iterator<[V1, V2]>
  }
  export = Set2
}

declare module 'cpu-stats' {
  type CPUInfo = {
    cpu: number,
    user: number,
    nice: number,
    sys: number,
    idle: number,
    irq: number
  }
  function stats(samplems: number, cb: (err: Error, result: CPUInfo[]) => void): void;
  export = stats
}
