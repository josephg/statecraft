import * as I from '../interfaces'
// import kvmem from './kvmem'
import singlemem, {setSingle} from './singlemem'
import readonly from './readonly'

export interface PollOpts {
  periodMS?: number,
  initialVersion?: I.Version,
  source?: I.Source,
}

const wait = (timeout: number) => new Promise(resolve => setTimeout(resolve, timeout))

// Mmmmmm I wonder if this should actually also wrap a backing store to write
// into...
export default async function poller(
    poll: () => Promise<any>,
    opts: PollOpts = {}): Promise<I.SimpleStore> {
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
  return readonly(inner)
}
