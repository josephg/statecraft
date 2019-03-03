
export type AsyncIterableIteratorWithRet<T> = AsyncIterableIterator<T> & {
  // AsyncIterableIterator declares the return function to be optional.
  // Having a return function is compulsory - its how the subscription is closed.
  // The value passed to return is ignored.
  return(value?: any): Promise<IteratorResult<T>>
}


export interface Stream<T> {
  append(val: T): void,
  end(): void,
  throw(err: any): void,
  iter: AsyncIterableIteratorWithRet<T>,
}

// Note: onDone is not called if the producer calls .end().
export default function<T>(onDone?: () => void): Stream<T> {
  // At least one of these lists is empty at all times.
  const buffer: T[] = []
  const resolvers: ([(v: IteratorResult<T>) => void, (err: any) => void])[] = []

  // Done signifies that there will be no more messages after the current
  // buffer runs dry.
  let done = false
  // Err signifies that something went wrong in the producer. Any subsequent
  // reads after the buffer will immediately return a promise rejection.
  let err: any | null = null

  const iter: AsyncIterableIteratorWithRet<T> = {
    // Calls to next() either eat the first item in buffer or create a new resolver.
    next(): Promise<IteratorResult<T>> {
      return buffer.length ? Promise.resolve({value: buffer.shift()!, done: false})
        : err ? Promise.reject(err)
        : done ? Promise.resolve({value: undefined as any as T, done: true})
        : new Promise((resolve, reject) => {resolvers.push([resolve, reject])})
    },
    return(): Promise<IteratorResult<T>> {
      // NOTE: return() here is for the iterator *consumer* to notify the
      // producer that they're done, and they don't want any more items. The
      // producer should call end(), which will still let the consumer eat the
      // last items before we start returning {done}.
      done = true

      // The resolvers list will almost certainly be empty anyway.
      for (const r of resolvers) {
        // This is silly.
        // https://github.com/Microsoft/TypeScript/issues/11375
        r[0]({value: undefined, done: true} as any as IteratorResult<T>)
      }

      buffer.length = resolvers.length = 0
      onDone && onDone()
      onDone = undefined // Avoid calling it again if we're called twice.
      return Promise.resolve({done} as any as IteratorResult<T>)
    },
    [Symbol.asyncIterator]() { return iter }
  }

  return {
    append(val) {
      // console.log('stream app', done, resolvers)
      if (done || err) return

      if (resolvers.length) {
        ;(resolvers.shift()!)[0]({value: val, done: false})
      } else {
        // TODO: We should collapse the catchup data objects in buffer.
        buffer.push(val)
      }
    },

    end() {
      // NOTE: This does *NOT* call onDone, since its triggered by the producer.
      // You should clean up yourself if you call this.
      done = true
      while (resolvers.length) {
        (resolvers.shift()!)[0]({value: undefined as any as T, done: true})
      }
    },

    throw(_err) {
      // console.warn('stream throw', _err.stack)
      // Put an error at the end of the stream. Any further reads will see it.
      // Note that this method is for the *producer*
      err = _err
      onDone && onDone()
      onDone = undefined
      while (resolvers.length) {
        (resolvers.shift()!)[1](err)
      }
    },

    iter,
  }
}
