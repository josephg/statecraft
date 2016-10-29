Need:

- Router
- Out from JS variable, in to JS variable
- Out from JSON file (using fs.watch), in to JSON file
- ditto mongo

- Views (passthrough, lazy-cached, active)

- Web middleware frontend

- Network proxy endpoints



Queries are versioned with 2 numbers: Min version at which the query is valid and max known version at which the query result is valid.

Say you have a diamond: q(raw data, index on data). The query to both backends goes through at the same time. Then when the two intervals come back the results are valid in the intersection of the returned ranges. If the ranges don't intersect, the query is stalled waiting for the slower thing to catch up to the more ahead thing.

The client can also specify a minimum version as part of the qeury. That provides another bound on the query results. Again, if one part of the network is behind then the query stalls until the index can answer at >= the specified version.



So the protocol will be something like:

given root -> router, root -> index -> router, router -> client:

client(active data set, client version: 90)
client: QUERY { set of key ranges }, version: (min: client version, max: infinity)

router: split query into ranges, send to ancestors.

root (currently at 100): -> {query results, (min: (max of edit version of result set), max: 100)}
index: (currently at 95): -> {query results, (min: ..., max: 95)}.
Router: .... waits for results from root and index. Then checks that result versions overlap. If not, discard lower version range and re-run query against out of date source.
Then send to client {query results, (max-of-mins, min-of-maxes)}.



As an algorithm:

client:
struct {
  accessToken: binary
  subscribedRanges: {Set of (k1, k2), ranges version}
	data: Set of (key, value, lastChangedVersion)
}

Two capabilities: fetchQuery and subscribeQuery. subscribeQuery will add another range to the subscribed ranges, send an op describing the data structure change to the server and then expect a data change back.


But lets talk about fetch first, then subscribeAll (aka sync) then subscribeRanges which is the most complicated.

And lets start with the one-root-data source case for now.


client:
struct {
	accessToken,
	minFieldVersion: version, <-- fetch results must have v >= max(last read or write version) for read-your-writes.
}

fetchQuery(Set of (key1, key2)) = {
  server.send({
    version range: (minFieldVersion, Infinity),
    data: (set of ranges)
  })
  ...
  

Router.fetchQuery(set of ranges, version range) = {
  Split set of ranges up according to mounts
  -> set of (server, set of ranges), version range
  
  For each listed server, send query to server.
  ...
  

root.fetchQuery(set of ranges, version range) = {
	if (version range min > current version) {
		wait until known version reaches minimum
	}
	Results = {} ({key -> value})
	minVersion = null
	start read transaction
	For each range {
	  fetch results from store -> results
	  minVersion = max(minVersion, field modified version)
	  if (field modified version > query max version) {
	    fail / abort with error: the past is lost in fog.
    }
  }
  return (results, v:(minVersion, currentVersion))
}

index.fetchQuery(set of ranges, version range) = {
	if (version range min > current version) {
		wait until known version reaches minimum
	}
  ... This is just the same as the root fetch query I think.
}



Router.fetchQuery, second half:
  Wait for results from mounted servers
  While (ranges don't overlap) {
    Well, a few options here. But the simplest is to just set min version to max(mins) and re-run any queries that no longer fit the range. Could also ask for the patch set from that older version. Which would be better, but implement later.
  }
  
  min = max of mins
  max = min of maxes (? is this correct?)
  data = map keys through mount point, then take union of results.
  return data to client.
}





- [x] Dumb fetch client
- [x] Dumb server supporting fetch for local variables
- [x] Dumb Router
- [ ] Router supports mount points
- [ ] Streaming protocol
- [ ] Update fetch to use stream when behind
- [ ] Browser client
- [ ] Leveldb server
- [ ] Version pairs