# LMDB Statecraft bindings

This is a simple statecraft binding for [LMDB](https://symas.com/lmdb/technical/). LMDB is a simple, fast embedded database.

The LDMB implementation currently does not act as an operation log. That is, the store depends on an externally provided operation log; which it subscribes to on startup. All changes are streamed into a local on-disk key-value store (lmdb).
