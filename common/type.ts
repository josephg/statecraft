export interface Type<Snap, Op> {
  name: string,
  create(data?: any): Snap
  apply(snapshot: Snap, op: Op): Snap
  checkOp?(op: Op): void
}

export interface OTType<Snap, Op> extends Type<Snap, Op> {
  // For core OT types:
  // Not sure if transform should be optional. TODO.
  transform?(op1: Op, op2: Op, side: 'left' | 'right'): Op,
  // And transform cursor and stuff.
  compose?(op1: Op, op2: Op): Op,
}

export interface OTWithCompose<Snap, Op> extends OTType<Snap, Op> {
  compose(op1: Op, op2: Op): Op,
}


export interface QueryOps<Snap, Op> extends Type<Snap, Op> {
  // Split an op into two parts - the part that intersects with the snapshot
  // and the part that doesn't.
  split(op: Op, snapshot: Snap): [Op, Op]
  intersectDocs(a: Snap, b: Snap): Snap
  isEmpty(snapshot: Snap): boolean
  isNoop(op: Op): boolean
  [p: string]: any
}

export type AnyOTType = OTType<any, any>