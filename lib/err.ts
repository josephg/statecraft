import errno = require('errno')

const create = errno.custom.createError

export const SCError = create('StatecraftError')
export const VersionTooOldError = create('VersionTooOldError', SCError)
export const WriteConflictError = create('WriteConflictError', SCError)
export const UnsupportedTypeError = create('UnsupportedTypeError', SCError)
