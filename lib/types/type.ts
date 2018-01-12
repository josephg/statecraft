import {ResultType} from './interfaces'

export interface Type<Snap, Op> {
  name: string,
  create(data?: any): Snap
  apply(snapshot: Snap, op: Op): Snap
  applyMut?(snapshot: Snap, op: Op): void
  checkOp?(op: Op, snapshot: Snap): void // Check the op is valid and can apply to the given snapshot

  // For core OT types:
  // Not sure if transform should be optional. TODO.
  transform?(op1: Op, op2: Op, side: 'left' | 'right'): Op,
  // And transform cursor and stuff.
  compose?(op1: Op, op2: Op): Op,

  [p: string]: any
}

export interface ResultOps<Snap, Op> extends Type<Snap, Op> {
  compose(op1: Op, op2: Op): Op
  composeMut?(op1: Op, op2: Op): void
  asOp(snap: Snap): Op
  from(type: ResultType, snap: any): Snap
}

export interface QueryOps<Snap, Op> extends Type<Snap, Op> {
  // Split an op into two parts - the part that intersects with the snapshot
  // and the part that doesn't.
  split(op: Op, snapshot: Snap): [Op, Op]
  intersectDocs(a: Snap, b: Snap): Snap

  // This must obey the constraint that isNoop(create()) is true.
  isEmpty(snapshot: Snap): boolean
  isNoop(op: Op): boolean

  add(a: Snap, b: Snap): Snap
  subtract(a: Snap, b: Snap): Snap,

  fromKVQuery?(snapshot: Set<any>): Snap,
}

export type AnyOTType = Type<any, any>