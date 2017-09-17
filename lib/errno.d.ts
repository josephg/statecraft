
declare module 'errno' {
  let custom: {
    createError(name: string, parent?: ErrorConstructor): ErrorConstructor
  }
}