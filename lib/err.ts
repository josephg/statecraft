import ExtendableError from 'es6-error'

class VersionTooOldError extends ExtendableError {}
class WriteConflictError extends ExtendableError {}
class UnsupportedTypeError extends ExtendableError {}
class AccessDeniedError extends ExtendableError {}
class InvalidDataError extends ExtendableError {}
class TxnConflictError extends ExtendableError {}

const constructors = {VersionTooOldError, WriteConflictError, UnsupportedTypeError, AccessDeniedError, InvalidDataError, TxnConflictError}
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
