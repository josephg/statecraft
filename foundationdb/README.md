# Statecraft Foundationdb store

This is a simple implementation of a statecraft wrapper for the [foundationdb](https://www.foundationdb.org/) database maintained by Apple.

This SC wrapper supports running a horizontally scaled set of statecraft stores all pointing to the same backing foundationdb cluster.

> Status: Ready for use, but see caveats below


## Usage

```javascript
const fdb = require('foundationdb')

// Configure foundationdb and create a database
fdb.setAPIVersion(600)
const db = fdb.openSync().at('my-prefix')

;(async () => {
  // Wrap the foundationdb database with statecraft!
  const store = await fdbStore(db)

  // ...
  // store.fetch(...), etc.
})()
```


## Supported queries

The foundationdb store acts as a key-value store with range support. So, you can run both standard KV queries and range queries against the store.


## Caveats

- There is currently no support for deleting old operations from the operation log in foundationdb.
- No performance tuning has been done yet.
- Large queries are handled by single FDB transactions. This means you will run into performance issues and transaction size limits (5M by default) if you're fetching a lot of data all at once. Please file an issue if this is important to you.

## License

ISC