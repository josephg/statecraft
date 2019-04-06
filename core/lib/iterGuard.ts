// This is a helper for async iterators which calls the cleanup function when the iterator is returned.
export default function iterGuard<T>(inner: AsyncIterator<T>, cleanupFn: () => void): AsyncIterableIterator<T> {
  let isDone = false
  let donefn: (v: IteratorResult<T>) => void
  const doneP = new Promise<IteratorResult<T>>(resolve => { donefn = resolve })

  const iter: AsyncIterableIterator<T> = {
    next() {
      return isDone
        ? Promise.resolve({done: true, value: undefined as any as T})
        : Promise.race([inner.next(), doneP])
    },
    return(v: T) {
      isDone = true
      const result = {value: v, done: true}
      donefn(result)
      cleanupFn()
      return Promise.resolve(result)
    },
    [Symbol.asyncIterator]() { return iter }
  }
  return iter
}
