// content: Return one value (the content of the store). Query ignored
// kv: Query with a set of keys, return corresponding values.
// sortedkv: Query set of ranges. return kv map with contained values
// all: Query ignored, return kv map with values.
export type QueryType = 'single' | 'allkv' | 'kv' | 'kvranges'
// TODO: consider renaming resultmap to kv.
export type ResultType = 'single' | 'resultmap'

export type Version = number
export type Source = string
export type Key = string // TODO: Relax this restriction.
export type Val = any

export type KVQuery = Set<Key>

export type FullVersion = {[s: string]: Version}

export type VersionRange = {from: Version, to: Version}
export type FullVersionRange = {[s: string]: VersionRange}

export type FetchResults = {
  // results: Map<Key, Val>,
  results: any, // Dependant on query.
  queryRun: any,
  versions: FullVersionRange, // Range across which version is valid.
}

export type Callback<T> = (err?: Error | null, results?: T) => void

export type FetchCallback = Callback<FetchResults>
export type FetchFn = (qtype: QueryType, query: any, opts: object, callback: FetchCallback) => void


export type CatchupResults = {
  txn: Txn, // Map from key => ops to bring up to date.
  queryRun: any,
  versions: FullVersionRange, // Resultant version post catchup.
}
export type CatchupFn = (qtype: QueryType, query: any, opts: object, callback: Callback<CatchupResults>) => void

export interface RangeOp {}

export interface SubscribeOpts {
  supportedTypes?: any,
  noFetch?: boolean,
  alwaysNotify?: boolean,

  knownAtVersions?: FullVersion,
}

export interface Subscription {
  // modify(qop, newqv)
  cursorNext(opts: any, callback: Callback<{
    activeQuery: any,
    activeVersions: FullVersionRange,
  }>): void
  isComplete(): boolean
  cancel(): void
}

export interface SingleOp {
  type: string,
  data?: any
  // source: Source,
  // v: Version,
  // meta: any,
}

export type Op = SingleOp | SingleOp[]

export type GetOpsResult = {
  ops: {source: Source, v: Version, txn: Txn}[],
  versions: FullVersionRange,
}

export type SingleTxn = Op
export type KVTxn = Map<Key, Op>
export type Txn = SingleTxn | KVTxn

export type Listener = (type: 'txn' | 'modify' | 'cursor', txn: Txn | null, v: FullVersionRange, s: Subscription) => void

export interface MutateOptions {
  conflictKeys?: Key[]
}

export type OpsSupport = 'none' | 'partial' | 'all'
export interface Capabilities {
  queryTypes: Set<QueryType>,
  mutationTypes: Set<ResultType>,
  ops:OpsSupport,
}

export interface Store {
  capabilities: Capabilities,

  // fetch(qtype: QueryType, query: any, opts: object, callback: FetchCallback): void
  fetch: FetchFn,
  catchup?: CatchupFn, // Can be generated from fetch.
  // fetch(qtype: 'all', query: null, opts: object, callback: FetchCallback): void
  // fetch(qtype: 'kv', query: Key[] | Set<Key>, opts: object, callback: FetchCallback): void
  // fetch(qtype: 'sortedkv', query: RangeOp, opts: object, callback: FetchCallback): void

  // Versions are {[source]: [from, to]} pairs where the data returned is in
  // the range of (from, to]. You can think of the results as the operations
  // moving from document version from to document version to.
  //
  // to:-1 will get all available operations.
  //
  // Options:
  // - bestEffort: if we can't get all the requested operations, don't abort
  //   but return what we can.
  // - limitBytes: Limit on the amount of data to read & return. Advisory
  //   only. Will always try to make progress (that is, return at least one
  //   operation). There is no limitDocs equivalent because you can just
  //   shrink the requested range if thats what you're after. NYI
  // - limitOps: Limit the number of operations returned. NYI
  getOps?(qtype: QueryType, query: any, versions: {[s: string]: [Version, Version]}, callback: Callback<GetOpsResult>): void

  // TODO: Should specifying a version be done through the options like it is for fetch?
  //
  // Options are:
  // - Supported operation types (opts.supportedTypes)
  // - No fetch (opts.noFetch) (implies opts.raw) (NYI)
  // - Notify re version bump regardless of query? (opts.alwaysNotify,
  //   default false) TODO: consider removing this?
  // - What to do if there's no ops available from requested version (NYI)
  // - Follow symlinks? (NYI)
  // - When we poll, how much data should we fetch? (opts.limitDocs, opts.limitBytes)
  // - Stop the query after a certain number of operations (opts.limitOps) (NYI)
  // - Should we send updates for the cursor object itself? (opts.trackCursor)
  //
  // For reconnecting, you can specify:
  // - Which documents the client has a copy of (opts.knownDocs)
  // - Which versions the specified documents are known at (opts.knownAtVersions)
  // - ... And something to specify the catchup mode (fast vs full)
  // - opts.getFullHistortForDocs - or something like it.
  // These options should appear together.
  subscribe(qtype: QueryType, query: any, opts: SubscribeOpts, listener: Listener): Subscription

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
  mutate(type: ResultType, txn: Txn, versions: FullVersion, opts: MutateOptions, callback: Callback<FullVersion>): void

  close?(): void
}

