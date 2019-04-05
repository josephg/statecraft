export type Resolvable<T> = Promise<T> & {resolve: (t: T) => void}
const resolvablePromise = <T = void>(): Resolvable<T> => {
  let resolve: (val: T) => void
  const promise = new Promise<T>(_resolve => {resolve = _resolve}) as Resolvable<T>
  promise.resolve = resolve!
  return promise
}
export default resolvablePromise