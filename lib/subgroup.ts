import * as I from './interfaces'
import streamToIter, {Stream} from './streamToIter'
import err from './err'
import {queryTypes, resultTypes} from './qrtypes'
import {vEq, vCmp, V_EMPTY} from './version'

const splitFullVersions = (v: I.FullVersionRange): [I.FullVersion, I.FullVersion] => {
  const from: I.FullVersion = []
  const to: I.FullVersion = []
  for (let i = 0; i < v.length; i++) if (v[i]) {
    from[i] = v[i]!.from
    to[i] = v[i]!.to
  }
  return [from, to]
}

type BufferItem = {
  sourceIdx: number, fromV: I.Version, toV: I.Version, txn: I.Txn<any>, meta: I.Metadata
}

type Sub<Val> = {
  q: I.Query | null
  // iter: I.Subscription,

  // When we get an operation, do we just send from the current version? Set
  // if SubscribeOpts.fromCurrent is set.

  // If fromCurrent is not set, this is the expected version for incoming operations.

  // This drives the state of the subscription:
  //
  // - If its null, we're waiting on fetch() and all the operations we see go into the buffer.
  // - If its 'current', we just pass all operations directly into the stream.
  //   opsBuffer should be null.
  // - If this is a version, we're either waiting for catchup (ops go into
  //   buffer) or we're ready and the ops are put straight into the stream.
  expectVersion: I.FullVersion | 'current' | null,
  // When the subscription is first opened, we buffer operations until catchup returns.
  opsBuffer: BufferItem[] | null,

  // Should the subscription be notified on every change, or just the ones
  // we're paying attention to?
  alwaysNotify: boolean,
  supportedTypes: Set<string> | null,

  // Do we need to store a local copy of the current subscription values? This
  // is needed if the subscriber doesn't support the op types that the
  // underlying store will emit.
  // TODO: Figure out a better way of deciding when we need this.
  trackValues: boolean,
  value?: any,

  // Stream attached to the returned subscription.
  stream: Stream<I.CatchupData<Val>>,

  id: number, // For debugging.
}

const isVersion = (expectVersion: I.FullVersion | 'current' | null): expectVersion is I.FullVersion => (
  expectVersion !== 'current' && expectVersion != null
)

let nextId = 1

export default class SubGroup<Val> {
  private readonly allSubs = new Set<Sub<Val>>()
  private readonly store: I.SimpleStore<Val>
  private readonly getOps: I.GetOpsFn | null

  constructor(store: I.SimpleStore<Val>, getOps?: I.GetOpsFn) {
    this.store = store
    this.getOps = getOps ? getOps : store.getOps ? store.getOps.bind(store) : null

    // Need at least one of these.
    if (this.getOps == null && store.catchup == null) {
      throw Error('Cannot attach subgroup to store without getOps or catchup function')
    }
  }
  
  async catchup(query: I.Query, opts: I.SubscribeOpts, trackValues: boolean): Promise<I.CatchupData<Val>> {
    // TODO: This should look at the aggregation options to decide if a fetch
    // would be the right thing to do.
    //
    // TODO: We should also catch VersionTooOldError out of catchup / getOps
    // and failover to calling fetch() directly.
    const {fromVersion} = opts
    if (fromVersion === 'current') {
      throw Error('Invalid call to catchup')

    } else if (fromVersion == null || trackValues) {
      // Initialize with a full fetch.
      const {bakedQuery, results, versions} = await this.store.fetch(query)
      // console.log('catchup with full fetch to version', versions, results)
      const [from, to] = splitFullVersions(versions)
      return {
        replace: {
          ...queryTypes[query.type].fetchToReplace((bakedQuery || query).q, results),
          versions: from,
        },
        txns: [],
        toVersion: to,
      }
    } else if (this.store.catchup) {
      // console.log('catchup with store.catchup()')
      // Use the provided catchup function to bring us up to date
      return await this.store.catchup(query, fromVersion, {
        supportedTypes: opts.supportedTypes,
        raw: opts.raw,
        aggregate: opts.aggregate,
        bestEffort: opts.bestEffort,
        // limitDocs, limitBytes.
      })
      
    } else {
      // console.log('catchup with store.getOps()')
      // Use getOps
      const getOps = this.getOps!

      // _other is used for any other sources we run into in getOps.
      // const versions: I.FullVersionRange = {_other: {from:V_EMPTY, to: V_EMPTY}}
      const versions: I.FullVersionRange = fromVersion.map(v => (v == null ? null : {from:v, to:V_EMPTY}))

      const {ops: txns, versions: opVersions} = await getOps(query, versions, {bestEffort: opts.bestEffort})
      const toVersion = splitFullVersions(opVersions)[1]
      return {txns, toVersion}
    }
  }

  onOp(source: I.Source,
      fromV: I.Version, toV: I.Version,
      type: I.ResultType, txn: I.Txn<Val>, resultingView: any,
      meta: I.Metadata) {
    if (vCmp(fromV, toV) >= 0) throw Error('Invalid op - goes backwards in time')
    const si = this.store.storeInfo.sources.indexOf(source)
    if (si < 0) throw Error('Invalid source')

    for (const sub of this.allSubs) {
      // console.log(sub.id, 'onOp version', sub.id, 'fv', fromV, 'tv', toV, 'buf', sub.opsBuffer, 'sub ev', sub.expectVersion, 'val', sub.value, 'txn', txn)

      // First filter out any op types we don't know about here
      // let _txn = sub.supportedTypes
      //   ? resultTypes[type].filterSupportedOps(txn, resultingView, sub.supportedTypes)
      //   : txn

      // console.log('sg onOp', fromV, toV, !!sub.opsBuffer)
      if (sub.opsBuffer) {
        // console.log('op -> opbuffer')
        sub.opsBuffer.push({sourceIdx: si, fromV, toV, txn, meta})
      } else {
        if (sub.q == null) throw Error('Invalid state')

        if (isVersion(sub.expectVersion)) {
          if (sub.expectVersion[si] && !vEq(sub.expectVersion[si]!, fromV)) {
            // This can happen if you fetch / mutate and get a future-ish
            // version, then try to subscribe to that version before that
            // version is propogated through the subscription channel. This
            // happens reliably with the fdb unit tests.
            //
            // Implemented this way we provide cover for bugs, its more correct.
            console.warn(sub.id, 'skip version', 'expect', sub.expectVersion[si], 'actual fromV', fromV, 'data', sub.value)
            continue
            // throw Error(`Invalid version from source: from/to versions mismatch: ${sub.expectVersion[source]} != ${fromV}`)
          }

          sub.expectVersion[si] = toV
        }

        const qtype = queryTypes[sub.q.type]
        const rtype = qtype.resultType
        // console.log('qtype', sub.q)
        // if (!qtype) throw Error('Missing type ' + sub.q.type)

        let localTxn = qtype.adaptTxn(txn, sub.q.q)

        if (localTxn != null && sub.trackValues) {
          // console.log('applyMut', sub.value, localTxn)
          if (rtype.applyMut) rtype.applyMut!(sub.value, localTxn)
          else (sub.value = rtype.apply(sub.value, localTxn))
          // console.log('sub value =>', sub.value, localTxn)

          // console.log('localTxn', localTxn, sub.q.q)
          localTxn = rtype.filterSupportedOps(localTxn, sub.value, sub.supportedTypes!)
        }

        // console.log(sub.id, 'propogate op', localTxn, toV)

        // This is pretty verbose. Might make sense at some point to do a few MS of aggregation on these.
        const fullToV = []
        fullToV[si] = toV

        if (localTxn != null || sub.alwaysNotify) sub.stream.append({
          txns: localTxn != null ? [{versions: fullToV, txn: localTxn as I.Txn<Val>, meta}] : [],
          toVersion: fullToV,
        })
      }

      // console.log('sub', sub.id, 'ev', sub.expectVersion)
    }
  }

  create(query: I.Query, opts: I.SubscribeOpts = {}): I.Subscription<Val> {
    // console.log('create sub', query, opts)
    
    if (query.type === 'range' && opts.fromVersion != null) {
      throw new err.UnsupportedTypeError('Can only subscribe to full range queries with no version specified')
    }
    
    const fromCurrent = opts.fromVersion === 'current'
    let qtype = queryTypes[query.type]
    
    const stream = streamToIter<I.CatchupData<Val>>(() => {
      // console.log(sub.id, 'sub closed')
      this.allSubs.delete(sub)
    })
    
    var sub: Sub<Val> = {
      // Ugh this is twisty. We need the query to filter transactions as they
      // come in. But also, for range queries we want to use the baked version
      // of the query instead of the raw query. If catchup gives us
      // replacement data, we'll use the query that came along there -
      // although thats not quite accurate either.
      q: opts.fromVersion != null ? query : null,
      alwaysNotify: opts.alwaysNotify || false,
      supportedTypes: opts.supportedTypes || null,
      trackValues: opts.trackValues || false,
      expectVersion: opts.fromVersion || null,
      opsBuffer: fromCurrent ? null : [],
      stream,
      id: nextId++,
    }
    // console.log(sub.id, 'created sub', 'expect version', sub.expectVersion, 'fromCurrent', fromCurrent, 'q', query)
    this.allSubs.add(sub)

    if (sub.trackValues) {
      const rtype = qtype.resultType
      sub.value = rtype.create()
    }

    // console.log('Creating sub', sub.id, 'fv', opts.fromVersion, sub.expectVersion, sub.opsBuffer)

    if (!fromCurrent) this.catchup(query, opts, sub.trackValues).then(catchup => {
      // debugger
      // So quite often if you're passing in a known version, this catchup
      // object will be empty. Is it still worth sending it?
      // - Upside: The client can depend on it to know when they're up to date
      // - Downside: Extra pointless work.
      // TODO: ^?

      // console.log('Got catchup', catchup)

      const catchupVersion = catchup.toVersion

      if (catchup.replace) {
        // TODO: Is this right?
        qtype = queryTypes[catchup.replace.q.type]
        sub.q = {
          type: catchup.replace.q.type,
          q: qtype.updateQuery(sub.q == null ? null : sub.q.q, catchup.replace.q.q)
        } as I.Query

        if (sub.trackValues) {
          sub.value = qtype.resultType.updateResults(sub.value, catchup.replace.q, catchup.replace.with)
          // console.log('sub.value reset to', sub.value)
        }
      }
      // console.log('catchup -> ', catchupVersion, catchup, sub.expectVersion, sub.q, query.type)
      
      if (sub.opsBuffer == null) throw Error('Invalid internal state in subgroup')

      // Replay the operation buffer into the catchup txn
      for (let i = 0; i < sub.opsBuffer.length; i++) {
        const {sourceIdx, fromV, toV, txn, meta} = sub.opsBuffer[i]
        // console.log('pop from opbuffer', source, {fromV, toV}, txn)
        const v = catchupVersion[sourceIdx]

        // If the buffered op is behind the catchup version, discard it and continue.
        if (v != null && vCmp(toV, v) <= 0) continue

        // console.log('adaptTxn', query.type, txn, sub.q!.q)
        const filteredTxn = qtype.adaptTxn(txn, sub.q!.q)
        if (v === fromV || vCmp(v!, fromV) === 0) {
          const fv = []
          fv[sourceIdx] = toV
          if (filteredTxn != null) catchup.txns.push({versions:fv, txn: filteredTxn, meta})
          catchupVersion[sourceIdx] = toV
          
          if (sub.trackValues) {
            const rtype = qtype.resultType
            if (rtype.applyMut) rtype.applyMut!(sub.value, txn)
            else (sub.value = rtype.apply(sub.value, txn))
            // console.log('sub value =>', sub.value, txn)
          }
        } else if (v != null) {
          // ... TODO: If the catchup fetched version is in between 
          // console.log('v', v, 'fromV', fromV, 'toV', toV)
          throw Error('Invalid operation data - version span incoherent')
        }
      }
      
      if (sub.expectVersion == null) sub.expectVersion = {...catchupVersion}
      else if (sub.expectVersion !== 'current') {
        for (let si = 0; si < catchupVersion.length; si++) {
          const v = catchupVersion[si]
          if (v != null) sub.expectVersion[si] = v
        }
      }
      sub.opsBuffer = null
      
      // Object.freeze(catchupVersion)

      // console.log('emitting catchup', catchup)
      stream.append(catchup)
    }).catch(err => {
      // Bubble up to create an exception in the client.
      sub.stream.throw(err)
    })

    return stream.iter
  }
}
