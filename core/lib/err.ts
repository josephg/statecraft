import ExtendableError from 'es6-error'

export class VersionTooOldError extends ExtendableError {}
export class WriteConflictError extends ExtendableError {}
export class UnsupportedTypeError extends ExtendableError {}
export class AccessDeniedError extends ExtendableError {}
export class InvalidDataError extends ExtendableError {}
export class StoreChangedError extends ExtendableError {}

const constructors = {VersionTooOldError, WriteConflictError, UnsupportedTypeError, AccessDeniedError, InvalidDataError, StoreChangedError}
export default constructors

export interface ErrJson {msg: string, name: string}

export const errToJSON = (err: Error): ErrJson => {
  // console.warn('Sending error to client', err.stack)
  return {msg: err.message, name: err.name}
}
export const errFromJSON = (obj: ErrJson) => {
  const Con = (constructors as {[k: string]: typeof ExtendableError})[obj.name]
  if (Con) return new Con(obj.msg)
  else {
    const err = new Error(obj.msg)
    err.name = obj.name
    return err
  }
}
