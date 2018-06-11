
export default function<T>(onCancel?: () => void) {
  let done = false

  // At least one of these lists is empty at all times.
  const buffer: T[] = []
  const resolvers: ((v: IteratorResult<T>) => void)[] = []

  const iter: AsyncIterableIterator<T> & {
    // Return function is non-optional.
    return(value?: any /* ignored */): Promise<IteratorResult<T>>
  } = {
    // Calls to next() either eat the first item in buffer or create a new resolver.
    next(): Promise<IteratorResult<T>> {
      if (buffer.length) {
        return Promise.resolve({value: buffer.shift()!, done})
      } else {
        return new Promise(resolve => {
          resolvers.push(resolve)
        })
      }
    },
    return(): Promise<IteratorResult<T>> {
      done = true
      for (const r of resolvers) {
        // This is silly.
        // https://github.com/Microsoft/TypeScript/issues/11375
        r({next: undefined, done: true} as any as IteratorResult<T>)
      }
      buffer.length = resolvers.length = 0
      onCancel && onCancel()
      onCancel = undefined // Avoid calling it again if we're called twice.
      return Promise.resolve({done} as any as IteratorResult<T>)
    },
    [Symbol.asyncIterator]() { return iter }
  }

  return {
    append(val: T) {
      if (done) return

      if (resolvers.length) {
        ;(resolvers.shift()!)({value: val, done: false})
      } else {
        // TODO: We should collapse the catchup data objects in buffer.
        buffer.push(val)
      }
    },

    iter,
  }
}
