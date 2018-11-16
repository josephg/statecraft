// single: Return one value (the content of the store). Query ignored
// allkv: Query all key-values in a kv database. Similar to single, but enforces kv.
// kv: Query with a set of keys, return corresponding values.
// sortedkv: Query set of ranges. return kv map with contained values
export type QueryType = 'single' | 'allkv' | 'kv' //| 'kvranges'
// TODO: consider renaming resultmap to kv.
export type ResultType = 'single' | 'resultmap'

export type Version = number
export type Source = string
export type Key = string // TODO: Relax this restriction.
export type Val = any

export type KVQuery = Set<Key>

export type FullVersion = {
  // _other?: Version,
  [s: string]: Version,
}

export type VersionRange = {from: Version, to: Version}
export type FullVersionRange = {
  // _other?: VersionRange
  [s: string]: VersionRange
}

// Wrapping single and allkv like this is sort of dumb, but it works better
// with TS type checks.
export type Query = {type: 'single' | 'allkv', q: boolean} | {
  type: 'kv',
  q: KVQuery,
} /*| {
  type: 'kvranges',
  q: void // TODO
}*/

// This is an internal type. Its sort of gross that it exists. I think
// eventually I'd like to move to using a single "empty" query type that
// completed queries end up at.
export type QueryData = KVQuery | boolean

// export type Result = {
//   type: 'single',
//   d: any
// } | {
//   type: 'resultmap',
//   d: Map<Key, Val>
// }

export interface SingleOp {
  readonly type: string,
  readonly data?: any
  // source: Source,
  // v: Version,
  // meta: any,
}

export type Metadata = {
  uid?: string, // unique ID
  ts?: number, // timestamp
}

// Only a list if the op type doesn't support compose. (Both set and rm support compose.)
export type Op = SingleOp | SingleOp[]
export type SingleTxn = Op
export type KVTxn = Map<Key, Op>
export type Txn = SingleTxn | KVTxn // SingleTxn for 'single', KVTxn for 'resultmap'.
export type TxnWithMeta = {
  versions: FullVersion,
  txn: Txn,
  meta: Metadata, // Unique ID generated by the client.
}

export type FetchResults = {
  // results: Map<Key, Val>,
  results: any, // Dependant on query.
  queryRun: Query,
  versions: FullVersionRange, // Range across which version is valid.
}

// export type Callback<T> = (err: Error | null, results?: T) => void

export type FetchOpts = {
  readonly noDocs?: boolean // Don't actually return any data. Useful for figuring out the version. Default: false

  // Results already known at specified version. Return nothing in this case.
  // readonly knownAtVersions?: FullVersion,
  // TODO: knownDocs?

  // TODO. This is useful / important for changing a query.
  // atLeastVersion: FullVersion
}

export type FetchFn = (q: Query, opts?: FetchOpts) => Promise<FetchResults>




export interface GetOpsOptions {
  // Supported client-side operation types. Also forwarded to getOps.
  readonly supportedTypes?: Set<string>, // TODO.

  // Ignore supportedTypes, just send full received ops. (default false)
  // readonly raw?: boolean,

  // bestEffort: if we can't get all the requested operations, don't abort
  //   but return what we can.
  readonly bestEffort?: boolean,

  // Options NYI:
  // - limitBytes: Limit on the amount of data to read & return. Advisory
  //   only. Will always try to make progress (that is, return at least one
  //   operation). There is no limitDocs equivalent because you can just
  //   shrink the requested range if thats what you're after. NYI
  // - limitOps: Limit the number of operations returned. NYI

  // Limit the number of ops returned.
  readonly limitOps?: number,
}

export type GetOpsResult = {
  ops: TxnWithMeta[],

  // This should return the range (from, to] of the returned set for each source.
  // ... which will be the same as the input if all ops are available, and there are no limits.
  versions: FullVersionRange,
}

export type GetOpsFn = (q: Query, versions: FullVersionRange, opts?: GetOpsOptions) => Promise<GetOpsResult>



export type CatchupData = {
  // This is more complicated than I'd like, but I'm reasonably happy with it.
  // The problem is that catchup isn't always possible, so sometimes you just
  // gotta send a diff with new documents in it; and you have no idea how you
  // got there.

  // Replace the results in q with this result set, if it exists
  replace?: {
    // This is a bit of a hack. If the query here contains more keys / ranges
    // than the original request, they should be added to the active known
    // set.
    // Queries are currently only expanded, so this works but a QueryDelta would
    // be better.
    q: Query,
    with: Map<Key, Val> | any, // Make a result set type for this

    // This is the max version for each source of the replacement data. This
    // becomes from:X if ingesting into a FullVersonRange.
    versions: FullVersion,
  },

  txns: TxnWithMeta[], // ... then apply txns.

  // This is the known upper end of the valid version range of the data
  // returned by catchup. For subscriptions this is a diff from what has been
  // reported previously, and usually it will just replay the max versions
  // listen in txns. But when calling alwaysNotify, this will keep updating as
  // the validity of the versions of the known data grows. This becomes to:X
  // when ingesting into a FullVersionRange. All sources here must have either
  // been passed in to subscribe / catchup or listed in a replace.
  toVersion: FullVersion,
}
// The updates argument here could either work as
//  {txn, v:fullrange}[]
// or
//  {txn, source, v:version}[] like in getOps.
// Its inconsistent how it is now, but this also makes it much more convenient
// to aggregate.


export interface CatchupOpts {
  // TODO: Probably more stuff needs to go in here.
  readonly supportedTypes?: Set<string>,
  readonly raw?: boolean,
  readonly aggregate?: 'yes' | 'prefer no' | 'no',
  readonly bestEffort?: boolean,

  readonly limitDocs?: number,
  readonly limitBytes?: number,
}
export type CatchupFn = (q: Query, fromVersion: FullVersion, opts: CatchupOpts) => Promise<CatchupData>


export interface SubscribeOpts {
  // Supported client-side operation types. Also forwarded to getOps.
  readonly supportedTypes?: Set<string>,
  // Ignore supportedTypes, just send full received ops. (default false)
  readonly raw?: boolean,

  // Can the store aggregate old updates into replacement data instead of
  // sending the full operation set? This will not always be possible - for
  // example, the backend server might have paged out / deleted old
  // operations.
  //
  // If never is passed, the server should error if the full operation log is
  // not available.
  readonly aggregate?: 'yes' | 'prefer no' | 'no',

  // bestEffort: if we can't get all the requested operations, don't error
  // but return what we can. Passed through to catchup & getOps.
  readonly bestEffort?: boolean,

  // Always notify about version bumps even if the query results are empty?
  // (default false)
  readonly alwaysNotify?: boolean,

  // Just subscribe to whatever's there, from the current version. If this is
  // passed, fromVersion is ignored and you just get all operations as they're
  // streamed live.
  // Functionally equivalent to calling subscribe(q, (await fetch(q, {noDocs:true})).version)).
  // readonly fromCurrent?: boolean,

  // Subscribe from the specified version. If this is passed, we'll send ops

  // TODO: Maybe rename current -> 'raw' ?
  fromVersion?: FullVersion | 'current',

  // NYI:
  // - Follow symlinks? (NYI)
  // - When we poll, how much data should we fetch? (opts.limitDocs, opts.limitBytes)
  // - Stop the query after a certain number of operations (opts.limitOps) (NYI)
  // readonly limitBytes: number,
}

export type AsyncIterableIteratorWithRet<T> = AsyncIterableIterator<T> & {
  // AsyncIterableIterator declares the return function to be optional.
  // Having a return function is compulsory - its how the subscription is closed.
  // The value passed to return is ignored.
  return(value?: any): Promise<IteratorResult<T>>,
}

export type Subscription = AsyncIterableIteratorWithRet<CatchupData>


// A subscription gives you a stream of operations. There's 3 modes a
// subscription can run in:
//
// 1. Fetch and subscribe. This is the default if you don't pass any options.
// The first update from the subscription will contain a replace: {} object
// with all the results from fetching the query, and subsequent updates will
// modify the query as needed.
//
// 2. Subscribe only. If you pass in fromVersion: {...} in the options, that
// indicates that the caller already has a copy of the query results at the
// specified version. We don't do any fetch, and instead just catch up from
// the specified version onwards. Use opts.aggregate to control whether the
// server is allowed to aggregate the initial catchup.
//
// 3. Raw subscribe. If you pass fromVersion: 'current', you get all
// operations as they come in.
export type SubscribeFn = (q: Query, opts?: SubscribeOpts) => AsyncIterableIteratorWithRet<CatchupData>





export interface MutateOptions {
  conflictKeys?: Key[],
  meta?: Metadata,
}

// TODO: Consider wrapping ResultType + txn in an object like I did with Query.
// Also the TxnWithMeta is made from txn, versions and opts.meta. Might be better to just pass a TxnWithMeta straight in.
export type MutateFn = (type: ResultType, txn: Txn, versions?: FullVersion, opts?: MutateOptions) => Promise<FullVersion>
// export type MutateFn2 = (type: ResultType, txn: Txn | TxnWithMeta, opts?: MutateOptions) => Promise<FullVersion>




export type OpsSupport = 'none' | 'partial' | 'all'
export interface Capabilities {
  readonly queryTypes: Set<QueryType>,
  readonly mutationTypes: Set<ResultType>,
  readonly ops?: OpsSupport,
}

export interface StoreInfo {
  // If there's one, and its available.
  // readonly source?: Source,
  readonly sources: Source[],

  readonly capabilities: Capabilities,

  // And ideally, recursive querying support.
  [k: string]: any
}

export type TxnListener = (source: Source, fromV: Version, toV: Version, type: ResultType, txn: Txn, meta: Metadata) => void


export interface SimpleStore {
  readonly storeInfo: StoreInfo, // TODO: Should this be a promise?

  // (q: Query, opts?: FetchOpts) => Promise<FetchResults>
  readonly fetch: FetchFn,

  // Modify the db. txn is a map from key => {type, data}. versions is just source => v.
  // TODO: Consider adding a txnType argument here as well.
  //
  // # On versions:
  //
  // The version specified here is the current expected database version. The
  // transaction itself will have a version equal to the new database version,
  // which will be greater.
  //
  // The version can be elided if you don't care what the database has when the
  // operation is submitted.
  //
  // So for example, given db at version 10, mutate(v:10) => transaction at
  // v:11, and afterwards db is at v:11.
  readonly mutate: MutateFn,

  // If needed.
  close(): void,

  // These are added automatically when store is augmented, but they can be supplied directly.
  readonly catchup?: CatchupFn,
  readonly getOps?: GetOpsFn,
  readonly subscribe?: SubscribeFn,

  // This is set by the store's wrapper. Could be implemented as an async
  // iterator - but this way makes it clear that we discard events when
  // there's no listener.
  // 
  // ... Eh. 🤷‍♀️
  onTxn?: TxnListener,
}

export interface Store extends SimpleStore {
  // Only if there's one, and its available.
  // readonly source?: Source,


  // catchup?: CatchupFn, // Can be generated from fetch. I think I can keep this private.


  // Versions are {[source]: [from, to]} pairs where the data returned is in
  // the range of (from, to]. You can think of the results as the operations
  // moving from document version from to document version to.
  //
  // to:-1 will get all available operations.
  readonly getOps: GetOpsFn

  // TODO: Should specifying a version be done through the options like it is for fetch?
  //
  // For reconnecting, you can specify knownDocs, knownAtVersions
  // - ... And something to specify the catchup mode (fast vs full)
  // - opts.getFullHistortForDocs - or something like it.
  // These options should usually appear together.
  readonly subscribe: SubscribeFn

  // And potentially other helper methods and stuff.
  [k: string]: any
}

