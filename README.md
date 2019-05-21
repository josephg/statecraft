# Statecraft

Statecraft is a protocol and set of tools for interacting with data that changes over time. It is the spiritual successor to [Sharedb](https://github.com/share/sharedb).

Statecraft sees the world as a series of stores. Each store has:

- Some data (A single value or a set of key-value pairs)
- A monotonically increasing version number

The store guarantees that the data is immutable with respect to time. (So if the data changes, the version number goes up).

Stores provide a standard set of methods to interact with the data:

- **Fetch**: Run a query against the data
- **Mutate**: Edit the data & bump the version
- **Subscribe**: Be notified when the data changes, and optionally also fetch the current state of the data.
- **GetOps**: *(Optional)* Get all operations in some specified version range. Stores can choose how much historical data to store and return.

A Statecraft store is more than just a database abstraction. They can provide an interface to:

- A file on disk
- A single variable in memory
- A computed view (eg rendered HTML)
- An event log (eg Kafka)
- A store which lives remotely over the network
- Some other remote API

And much more.

Unlike traditional transactional databases, Statecraft stores compose together like LEGO. Stores wrap one another, adding functionality or changing the behaviour of the store living underneath in the process.

For example:

- The `readonly` store transparently provides access to the underlying store, but disallows any mutation.
- A `cache` store caches all queries made to the underlying store, and can return subsequent queries directly
- The `map` store runs all fetch and subscribe result values through a mapping function.
- The network server and client allow you to use a Statecraft store living on another computer as if it existed locally. This works between servers or from a web browser over websockets.

The philosophy of Statecraft is to "ship the architecture diagram". You should be able to take your whiteboard diagram of your application and construct (almost) all of it directly out of Statecraft stores. No reimplementation or integration necessary. And because the stores are standard, we can have standard tools for debugging too.


## Queries

Statecraft's `fetch` and `subscribe` functions use queries to specify the data to return.

Currently there's 3 standard supported query types:

- *Single value query* (`Single`). This is for stores which just expose a single value. Aka, fetch everything. Single value queries return a single value result.
- *Key-value queries* (`KV`). These contain a list (or a set) of keys to fetch, and return a map of key-value pairs in response. There is also an `AllKV` variant which requests all key-value pairs in the store.
- *Range queries*. These specify a list of ranges (start & end pairs) to fetch. They can optionally specify a limit and offset for the start and end of the range, although not all stores support all of these fields.

I've made a proof-of-concept store which adds GraphQL schema & query support, but this is not yet fully merged.


## Ok that sounds great but how do I use it?

Full developer API documentation is still in the works. Sorry.

For now you can look through the type definitions (with documentation) for stores and queries [in lib/interfaces.ts](https://github.com/josephg/statecraft/blob/master/core/lib/interfaces.ts). The set of available core stores is [in lib/stores/](https://github.com/josephg/statecraft/tree/master/core/lib/stores). And there are some demos showing different ways to use the API in [demos/](https://github.com/josephg/statecraft/tree/master/demos).


## Why is this written in Typescript?

Javascript has been to make a proof of concept because it was easy and it demos well.

Statecraft is language agnostic and my plan is to have implementations in many other languages too. Once async/await support is [in rust proper](https://areweasyncyet.rs), I would like to port Statecraft's core into rust.

The API is designed to make it easy to re-expose a statecraft store over the network. For this reason it should be easy to build applications on top of Statecraft which use a mixed set of languages. For example, you should be able to write your blog rendering function in Rust or Go but use the existing nodejs code to cache the results and expose it over websockets. This requires compatible Statecraft implementations in Go, Rails, Python, Rust, Swift, etc. These are waiting on a standardization push for the network API, which is coming but not here yet.


## Status

Statecraft is in an advanced proof-of-concept stage. It works, but you and your application may need some hand holding. There are rough edges.

If you want help building Statecraft, making stuff on top of Statecraft, or if you would like to help with Statecraft [get in touch](mailto:me@josephg.com).


## License

Statecraft is licensed under the ISC:

```
Copyright 2019 Joseph Gentle

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND
FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.
```
