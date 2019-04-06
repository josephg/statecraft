import * as I from '../interfaces'
// import kvmem from './kvmem'
import singlemem from './singlemem'
import readonly from './readonly'
import {setSingle} from '../simple'

export interface PollOpts {
  periodMS?: number,
  initialVersion?: number,
  source?: I.Source,
}

const wait = (timeout: number) => new Promise(resolve => setTimeout(resolve, timeout))

// Mmmmmm I wonder if this should actually also wrap a backing store to write
// into...
export default async function poller<Val>(
    poll: () => Promise<Val>,
    opts: PollOpts = {}): Promise<I.Store<Val>> {
  const initial = await poll()
  const inner = singlemem(initial, opts.source, opts.initialVersion)

  const periodMS = opts.periodMS || 3000
  ;(async () => {
    while (true) {
      await wait(periodMS)
      const newVal = await poll()
      // console.log('..', newVal)
      await setSingle(inner, newVal)
    }
  })()

  // TODO: Read only wrapper!
  return readonly<Val, typeof inner>(inner)
}
