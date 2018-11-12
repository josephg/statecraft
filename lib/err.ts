import create = require('errno/custom')

const SCError = create('StatecraftError')
const constructors = {
  VersionTooOldError: create('VersionTooOldError', SCError),
  WriteConflictError: create('WriteConflictError', SCError),
  UnsupportedTypeError: create('UnsupportedTypeError', SCError),
  AccessDeniedError: create('AccessDeniedError', SCError),
  InvalidDataError: create('InvalidDataError', SCError),
}
export default constructors

export interface ErrJson {msg: string, name: string}

export const errToJSON = (err: Error): ErrJson => {
  // console.warn('Sending error to client', err.stack)
  return {msg: err.message, name: err.name}
}
export const errFromJSON = (obj: ErrJson) => {
  const Con = (constructors as {[k: string]: ErrorConstructor})[obj.name]
  if (Con) return new Con(obj.msg)
  else {
    const err = new Error(obj.msg)
    err.name = obj.name
    return err
  }
}
