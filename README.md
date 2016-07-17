# Statecraft

> This is a work in progress / proof of concept for now. The API is incomplete. Do not use this project for anything yet.

Statecraft is a database middleware tool for intelligent sourcing and syncing. Its designed as the spiritual successor to [sharedb](https://github.com/share/sharedb), by the same original author.

The core insight is that most modern databases try to do too much. They're all great at something, but no single database provides all the features I want:

- Elasticsearch is a great full text search engine, but its generic data storage isn't very capable.
- Couchdb has an awesome document view / rendering system, but no type checking
- Rethinkdb's realtime query support is amazing, but it has no support for multi-key transactions
- Postgres has beautiful reliability and multi-key transactions but its best features are only accessable via its super complicated internal scripting engine.
- Leveldb is super easy to get started with but it won't scale past a single server / backend instance
- Mongodb is like smoking - its easy to start using, and way too difficult to quit.

Making yet another database implementation won't anything. I'll just end up with my own set of halfbaked non-core features.

Modern applications need something better. The goal of statecraft is to provide a simple view over a constellation of database services, exposing a useful common set of features without stopping you using the raw functionality of the
databases themselves.

The constellation of databases will look like a DAG of services and views, mounted into a single namespace that your application can access. As your infrastructure needs grow so will the set of services your application depends on. Your application will always talk the same database protocol - but it'll be talking to a different set of underlying services as it grows.

> **TODO:** Explain this more with some diagrams.

For now I'm implementing the features of statecraft through a simple nodejs API wrapped around levelup. After I'm happy with that I'm going to make a standard network API then let the tooling combinatorial fun begin.

## Core features

- KV store for now just storing JSON or binary blobs
- Optional type annotations for schema validation
- Opt-in fully serialized multi-key transactions
- Rethinkdb-style realtime streaming / mongodb oplog tailing
- Support for operational transform to handle write conflicts. In the network protocol there'll be a capabilities handshake of some sort.
- Arbitrary queries passed straight to part of the database. I want to support SQL without needing to parse SQL.
- Some form of [multiversion concurrency control](https://en.wikipedia.org/wiki/Multiversion_concurrency_control)
- Capability based security model.

By virtue of the mounting system these features can be added trivially by databases in the DAG without adding complexity to the core:

- Couchdb-style views. Values could be served from a cache or generated at runtime
- Rethinkdb-style database proxies for load balancing, CDN
- Custom indexers
- Databases can provide reliability clusters via RAFT, etc
- Authentication proxies. Its easy to write a service which uses fine-grained access control rules to expose part of your database to the public.
- Extend the database API all the way to the browser, firebase style.
- Realtime streaming backup services
- Oplogs as a service, providing a way to time travel through the data set
- Clean web-based admin tool.


## Goals, non-goals

- The system should be able to scale up (perform well in large installations) as well as scale down, and be used as a tiny lightweight configuration store for applications.
- Tiny, light, lean. Made out of well designed small pieces.
- Realtime collaborative text editing should be easy to support using the feature set available out of the box

- The system is **not** designed to support timeseries databases. They have a different shape. Its possible the API I end up with will work well for them anyway, but its a non-goal for now.