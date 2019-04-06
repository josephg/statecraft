
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
