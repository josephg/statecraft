# A User Guide to Statecraft

The core of the statecraft API is idea of a *Store*. Understanding stores is essential to understanding statecraft.

## Stores

Stores are a semantic wrapper around:

- Some data (A single value or a set of key-value pairs)
- A monotonically increasing version number (or in some rare cases, multiple version numbers).

The store interface is intended to be like studs on a lego brick - its a composable, interoperable API for interacting with data that changes over time.

The store interface is designed to be a generic way to access just about any kind of data, including:

- Databases
- Files on disk
- Values in memory
- Computed views (computed lazily or eagerly)
- Indexes
- Caches
- Event sources
- Other APIs (REST, etc)

The store API is implemented as a typescript interface, not a class. Any javascript object which conforms to the store interface will work & interoperate with all other statecraft stores, network code and user applications.

The store API is just a handful of functions:

- **fetch**: Run a query against the data and return the results
- **mutate**: Edit the data & bump the version
- **subscribe**: Optionally fetch the data. Get notified when it changes.
- **getOps**: Get historical operations that have modified the data

For more detail, see the typescript interface documentation for the Store type *(TODO: Link to documentation of lib/interfaces.ts)*

Stores are sort of a cross between observables (eg RxJS), an event log (eg Kafka) and a database (eg LevelDB). Unlike observables, they have an explicit version. That version number ties together a whole database full of data - not just a single value. It also allows clients to reconnect without needing to download all the data again.


## Composability

Lots of stores work by wrapping an 'upstream' store, passing queries to the store upstream but adding some functionality along the way. For example:

- An access control store might run all `mutate` requests through an access control function.
- A mapping store can modify any queried data, passing it through a function before returning it.
- Network client stores act as proxies for stores that actually live on a remote host somewhere.

In this way, applications are constructed of either a chain or a [DAG](https://en.wikipedia.org/wiki/Directed_acyclic_graph) of stores.

Data flow always goes one way. Written data flows upwards, toward a root store. The root store commits the change, then notifies any downstream subscriptions. This may trigger updates further downstream, and so on.

---

With this design, tools written against the store API should work in lots of applications. They should also work across programming language and network boundaries.

For example, consider a store that performs active caching. The store works by `subscribe()`-ing to an upstream store's event feed. Each change is applied to a local on-disk store. When a downstream consumer calls `fetch` or `subscribe`, we can respond immediately using the data stored locally on disk.

You could use this store to:

- Cache the results of database queries, taking the read load off a slower SQL database sitting behind the cache. For this, you would arrange your stores in a chain of `root` -> `cache` -> `net server` -> (`net client` -> `application`) on each frontend server.
- Implement a global CDN. You would do this by arranging your servers as `root` -> `net server` -> (`net client` -> `cache` -> `CDN API`) on each globally distributed CDN server
- Cache the rendered HTML of your a blog. You would do this by arranging your servers as `root` -> `render data to HTML` -> `cache` -> `HTTP server`.
- Consume data from some rate limited 3rd party API. Eg, `SC API gateway wrapper` -> `cache` -> `application`.


## Whats in the box of Statecraft Core

Statecraft core is designed to provide a standard set of zero-dependancy tools that are useful in lots of statecraft applications. Core is made up of:

- A set of standard stores (in `lib/stores` and described below)
- Some utility functions for interacting with those stores
- Tools to help you make your own stores
- Typescript interface definitions of the above

There are also some other statecraft libraries you might find useful:

- **net**: Server and client implementations for exposing and consuming with statecraft stores over TCP and websockets.
- **demos**: Example demo applications showing how to use statecraft in some simple and complex ways. The demos directory also currently contains `universalclient` - which is a universal tool to connect and monitor any statecraft store. This is too useful to be just a demo. At some point this will be pulled and maintained separately.
- **foundationdb/lmdb/filestore**: These are statecraft store wrappers around other data (foundationdb, lmdb and files on disk). Most statecraft applications will use one of these as the root store in their DAG.

Over time I hope we can add more useful standard building blocks to statecraft core, and add more integrations for 3rd party databases. (Like Postgres, Mongodb, the ethereum blockchain, Elasticsearch, Contentful, S3, ShareDB, and lots of other sources of truth in the world of computing.)


### Standard stores

Statecraft core comes with some simple standard stores to get you started.

Root stores:

- `singlemem`: This is a store that simply wraps a variable in memory. This is useful when you want to use statecraft as a simple observable library. Its also useful for pushing local state to remote machines - eg, a singlemem store might store local CPU utilization that is then pushed to a monitoring server. See demos/monitor for this idea in action.
- `kvmem`: This is an in-memory key-value store. It is very similar to `singlemem`, but it also supports passing an inner store which is used as an operation log. This allows you to use kvmem as a simple in-memory cache of some other small data set.
- `opmem`: This is a trivial in-memory event log store. You can't actually fetch data from this store, because it never materializes the operations into the resulting data. This is mostly just used for testing.
- `poll`: This store periodically polls a user-supplied function, and exposes a store which wraps the value over time. This is useful for consuming a REST service via statecraft which has no way to get changes other than periodic polling. This store is readonly.

Combinators:

- `readonly`: This is a super simple store which wraps an upstream store, but disallows local call to `store.mutate`.
- `splitwrites` is a store which sends reads to one upstream store and writes to a different upstream store.
- `map`: This store wraps some upstream store, but passes all returned data through a function specified at store creation time. A map store is essentially a computed view from SQL or CouchDB. This is useful for rendering data into HTML, or doing other expensive transformations over your data. Note that the map store is lazy - it does not materialize your view eagerly, nor does it cache the results. Put a cache in front of your view store if your view function is expensive to compute. This store is readonly.
- `onekey`: This is a simple combinator which exposes a single key from a KV store as a single value store. Reads and writes to this store's value are converted to reads and writes to the specified key on the upstream store.
- `ot`: This store wraps mutate calls in an operational transform retry loop for building realtime collaborative editing. It basically implements the OT code of firepad. See the text demo for this in action. (Although note the text demo can be simplified with recent statecraft code changes.)
- `router`: Router lets you tie multiple statecraft stores together into a single store. This is useful in lots of situations - it gives you a single store to expose over network endpoints, it lets you filter a KV keyspace and it lets you run a single subscription or a single query that operates over multiple stores behind the scenes. This store is extremely complex internally, and for now comes with a handful of caveats and limitations.

Note that there is no store dedicated to caching. Both the `kvmem` store, as well as the non-core `lmdb` store operate as active caches. I may add a separate dedicated cache store to statecraft at some point.

Note that there are also some handy stores living outside of statecraft core:

- `net/tcpclient` / `net/wsclient`: These stores connect to a store living on a remote machine. They re-expose the statecraft API locally to allow you to communicate with a remote store as if it were local. See the documentation for the network library. The net library also allows a few more exotic configurations - like having network clients expose a store to the server they connect to, or bidirectional network stores where both the client and server expose a store to *each other*.
- LMDB store: This is another root store wrapping [lmdb](http://www.lmdb.tech/doc/). LMDB is a very fast BTree-based local file database, like SQLite but faster and only supporting key-value pairs. This database wraps an underlying operation stream - so it also functions as a cache. Unfortunately at the moment you *must* use an underlying operation log with this store, making it less useful than it could be.
- Foundationdb store: This is currently the recommended production ready root store for building applications on top of statecraft. [Foundationdb](https://www.foundationdb.org/) is a high performance, extremely robust distributed key-value store that has been battle tested in all sorts of places.


# Queries


# Utilities

# Making your own store


