// This is a simple in-memory mock for prozess. This is useful so we don't
// have to spin up & down lots of prozess instances to run tests.

// This can't be used outside of tests because its used as the central source
// of truth, and it loses all content on restart. So if you back an LMDB store
// with this, it'll correctly fail to restart.

import {
  PClient,
  VersionConflictError,
  Event,
} from 'prozess-client'
import genSource from '../lib/gensource'

const clamp = <T>(x: T, a: T, b: T) => x < a ? a : (x > b ? b : x)

export default function createMock(): PClient {
  interface MockEvent extends Event {
    conflictKeys: string[],
  }

  const base = 0xff01 // Pretend the mock starts at some offset in the file
  const events: MockEvent[] = []
  const nextVersion = () => base + events.length

  let subscribed = false

  const addEvent = (
    data: Buffer | string,
    targetVersion: number = events.length,
    conflictKeys: string[] = []) => {

    // debugger
    // This isn't super efficient - it'd be better to sort and walk together.
    // But this is just for testing so it shouldn't matter.
    const ckSet = new Set(conflictKeys)

    // Version of the event
    const ev = nextVersion()

    for (targetVersion = clamp(targetVersion, base, ev);
        targetVersion < ev;
        targetVersion++) {
      const e = events[targetVersion - base]
      for (const k of e.conflictKeys) {
        if (ckSet.has(k)) return null // Write conflict.
      }
    }

    const event = {
      version: ev,
      crc32: 0, // dummy.
      batch_size: 1,
      flags: 0,
      data: typeof data === 'string' ? Buffer.from(data) : data,
      conflictKeys: conflictKeys || [],
    }

    events.push(event)
    return event
  }

  return {
    source: genSource(),
    onevents: undefined,
    onclose: undefined,
    onunsubscribe: undefined,

    subscribe(from, opts, callback) {
      process.nextTick(() => {
        if (from == null || from < 0 || from > nextVersion()) from = nextVersion()

        // First forward a bunch of events
        const idx = from - base
        const evts = events.slice(idx)
        this.onevents && this.onevents(evts, from)
        subscribed = true

        callback && callback(null, {
          v_start: from,
          v_end: nextVersion(),
          size: evts.reduce((sum, e) => e.data.length + sum, 0),
          complete: false,
          oneshot: false,
          current: true,
          events: evts,
        })
      })
    },

    // This gets ops in the range [from, to].
    getEventsRaw(from, to, opts, callback) {
      process.nextTick(() => {
        const f = clamp(from - base, 0, events.length) // Allowed to fall off the end.
        const t = to === -1 ? undefined : clamp(to - base, 0, events.length-1)+1
        const evts = events.slice(f, t)
        callback && callback(null, {
          v_start: f+base,
          v_end: f+base + evts.length,
          complete: true,
          current: false,
          oneshot: true,
          size: evts.reduce((sum, e) => e.data.length + sum, 0),
          events: evts,
        })
      })
    },

    getEvents(from, to, opts) {
      return new Promise((resolve, reject) => {
        this.getEventsRaw(from, to, opts, (err, data) => {
          if (err) reject(err)
          else resolve(data)
        })
      })
    },

    sendRaw(data, opts, callback) {
      const {targetVersion, conflictKeys} = opts
      if (callback) process.nextTick(() => {
        const event = addEvent(data, targetVersion, conflictKeys)
        if (event == null) callback(new VersionConflictError('Rejected event due to conflict'))
        else {
          if (subscribed && this.onevents) this.onevents([event], event.version)
          callback(null, event.version)
        }
      })
    },

    send(data, opts = {}) {
      return new Promise((resolve, reject) => {
        this.sendRaw(data, opts, (err, version) => {
          if (err) reject(err)
          else resolve(version)
        })
      })
    },

    getVersion() {
      // base + events.length is next version.
      return Promise.resolve(nextVersion() - 1)
    },

    close() {},
  }
}
