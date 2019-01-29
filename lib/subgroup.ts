import * as I from './interfaces'
import streamToIter, {Stream} from './streamToIter'
import err from './err'
import {queryTypes, resultTypes} from './qrtypes'
import {vEq, vCmp, V_EMPTY} from './version'

const splitFullVersions = (v: I.FullVersionRange): [I.FullVersion, I.FullVersion] => {
  const from: I.FullVersion = {}
  const to: I.FullVersion = {}
  for (const s in v) {
    from[s] = v[s].from
    to[s] = v[s].to
  }
  return [from, to]
}

type BufferItem = {
  source: I.Source, fromV: I.Version, toV: I.Version, txn: I.Txn, meta: I.Metadata
}

type Sub = {
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

  // Stream attached to the returned subscription.
  stream: Stream<I.CatchupData>,

  id: number, // For debugging.
}

const isVersion = (expectVersion: I.FullVersion | 'current' | null): expectVersion is I.FullVersion => (
  expectVersion !== 'current' && expectVersion != null
)

let nextId = 1

export default class SubGroup {
  private readonly allSubs = new Set<Sub>()
  private readonly store: I.SimpleStore
  private readonly getOps: I.GetOpsFn | null

  constructor(store: I.SimpleStore, getOps?: I.GetOpsFn) {
    this.store = store
    this.getOps = getOps ? getOps : store.getOps ? store.getOps.bind(store) : null

    // Need at least one of these.
    if (this.getOps == null && store.catchup == null) {
      throw Error('Cannot attach subgroup to store without getOps or catchup function')
    }
  }
  
  async catchup(query: I.Query, opts: I.SubscribeOpts): Promise<I.CatchupData> {
    // TODO: This should look at the aggregation options to decide if a fetch
    // would be the right thing to do.
    //
    // TODO: We should also catch VersionTooOldError out of catchup / getOps
    // and failover to calling fetch() directly.
    const {fromVersion} = opts
    if (fromVersion === 'current') {
      throw Error('Invalid call to catchup')

    } else if (fromVersion == null) {
      // Initialize with a full fetch.
      const {bakedQuery, results, versions} = await this.store.fetch(query)
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
      // Use the provided catchup function to bring us up to date
      return await this.store.catchup(query, fromVersion, {
        supportedTypes: opts.supportedTypes,
        raw: opts.raw,
        aggregate: opts.aggregate,
        bestEffort: opts.bestEffort,
        // limitDocs, limitBytes.
      })

    } else {
      // Use getOps
      const getOps = this.getOps!

      // _other is used for any other sources we run into in getOps.
      const versions: I.FullVersionRange = {_other: {from:V_EMPTY, to: V_EMPTY}}

      if (fromVersion) for (const source in fromVersion) {
        versions[source] = {from:fromVersion[source], to: V_EMPTY}
      }
      const {ops: txns, versions: opVersions} = await getOps(query, versions, {bestEffort: opts.bestEffort})
      const toVersion = splitFullVersions(opVersions)[1]
      return {txns, toVersion}
    }
  }

  onOp(source: I.Source,
      fromV: I.Version, toV: I.Version,
      type: I.ResultType, txn: I.Txn, resultingView: any,
      meta: I.Metadata) {
    if (vCmp(fromV, toV) >= 0) throw Error('Invalid op - goes backwards in time')
    for (const sub of this.allSubs) {
      // console.log('onOp version', sub.id, 'fv', fromV, 'tv', toV, 'buf', sub.opsBuffer, 'sub ev', sub.expectVersion)
      // First filter out any op types we don't know about here
      let _txn = sub.supportedTypes
        ? resultTypes[type].filterSupportedOps(txn, resultingView, sub.supportedTypes)
        : txn

      // console.log('sg onOp', fromV, toV, !!sub.opsBuffer)
      if (sub.opsBuffer) sub.opsBuffer.push({source, fromV, toV, txn: _txn, meta})
      else {
        if (sub.q == null) throw Error('Invalid state')

        if (isVersion(sub.expectVersion)) {
          if (!vEq(sub.expectVersion![source], fromV)) {
            // This can happen if you fetch / mutate and get a future-ish
            // version, then try to subscribe to that version before that
            // version is propogated through the subscription channel. This
            // happens reliably with the fdb unit tests.
            //
            // Implemented this way we provide cover for bugs, its more correct.
            continue
            // throw Error(`Invalid version from source: from/to versions mismatch: ${sub.expectVersion[source]} != ${fromV}`)
          }

          sub.expectVersion[source] = toV
        }

        const qtype = queryTypes[sub.q.type]
        // console.log('qtype', sub.q)
        // if (!qtype) throw Error('Missing type ' + sub.q.type)
        const localTxn = qtype.adaptTxn(_txn, sub.q.q)
        // console.log('onop', txn, localTxn)

        // This is pretty verbose. Might make sense at some point to do a few MS of aggregation on these.
        if (localTxn != null || sub.alwaysNotify) sub.stream.append({
          txns: localTxn != null ? [{versions: {[source]:toV}, txn: localTxn, meta}] : [],
          toVersion: {[source]:toV},
        })
      }

      // console.log('sub', sub.id, 'ev', sub.expectVersion)
    }
  }

  create(query: I.Query, opts: I.SubscribeOpts = {}): I.Subscription {
    if (query.type === 'range' && opts.fromVersion != null) {
      throw new err.UnsupportedTypeError('Can only subscribe to full range queries with no version specified')
    }

    const fromCurrent = opts.fromVersion === 'current'
    const qtype = queryTypes[query.type]

    const stream = streamToIter<I.CatchupData>(() => {
      this.allSubs.delete(sub)
    })

    var sub: Sub = {
      // Ugh this is twisty. We need the query to filter transactions as they
      // come in. But also, for range queries we want to use the baked version
      // of the query instead of the raw query. If catchup gives us
      // replacement data, we'll use the query that came along there -
      // although thats not quite accurate either.
      q: opts.fromVersion != null ? query : null,
      alwaysNotify: opts.alwaysNotify || false,
      supportedTypes: opts.supportedTypes || null,
      expectVersion: opts.fromVersion || null,
      opsBuffer: fromCurrent ? null : [],
      stream,
      id: nextId++,
    }
    // console.log('created sub', 'expect version', sub.expectVersion, 'fromCurrent', fromCurrent, 'q', query, sub)
    this.allSubs.add(sub)

    // console.log('Creating sub', sub.id, 'fv', opts.fromVersion, sub.expectVersion, sub.opsBuffer)

    if (!fromCurrent) this.catchup(query, opts).then(catchup => {
      // debugger
      // So quite often if you're passing in a known version, this catchup
      // object will be empty. Is it still worth sending it?
      // - Upside: The client can depend on it to know when they're up to date
      // - Downside: Extra pointless work.
      // TODO: ^?

      // console.log('Got catchup', catchup)

      const catchupVersion = catchup.toVersion

      if (catchup.replace) sub.q = {
        type: query.type,
        q: qtype.updateQuery(sub.q == null ? null : sub.q.q, catchup.replace.q.q)
      } as I.Query
      // console.log('catchup -> ', catchupVersion, catchup, sub.expectVersion, sub.q, query.type)
      
      if (sub.opsBuffer == null) throw Error('Invalid internal state in subgroup')

      // Replay the operation buffer into the catchup txn
      for (let i = 0; i < sub.opsBuffer.length; i++) {
        const {source, fromV, toV, txn, meta} = sub.opsBuffer[i]
        const v = catchupVersion[source]

        // If the buffered op is behind the catchup version, discard it and continue.
        if (v != null && vCmp(toV, v) <= 0) continue

        const filteredTxn = qtype.adaptTxn(txn, sub.q!.q)
        if (v === fromV || vCmp(v, fromV) === 0) {
          if (filteredTxn != null) catchup.txns.push({versions:{[source]: toV}, txn: filteredTxn, meta})
          catchupVersion[source] = toV
        } else if (v != null) {
          // ... TODO: If the catchup fetched version is in between 
          // console.log('v', v, 'fromV', fromV, 'toV', toV)
          throw Error('Invalid operation data - version span incoherent')
        }
      }
      
      if (sub.expectVersion == null) sub.expectVersion = catchupVersion
      else if (sub.expectVersion !== 'current') {
        for (const s in catchupVersion) sub.expectVersion[s] = catchupVersion[s]
      }
      sub.opsBuffer = null

      // console.log('catchup', catchup)
      stream.append(catchup)
    }).catch(err => {
      // Bubble up to create an exception in the client.
      sub.stream.throw(err)
    })

    return stream.iter
  }
}
