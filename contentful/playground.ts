
const contentful = async () => {
  const keys = JSON.parse(readFileSync('keys.json', 'utf8'))
  const ops = createContentful(await kvStore(), {
    space: keys.space,
    accessToken: keys.contentAPI,

  })

  const store = await kvStore(undefined, {inner: ops})
  const sub = store.subscribe({type: I.QueryType.StaticRange, q: [{
    low: sel(''),
    // low: sel('post/'),
    high: sel('post/\xff'),
  }]})
  // for await (const r of sub) {
  //   console.log('results', ins(r))
  // }
  for await (const r of subValues(I.ResultType.Range, sub)) {
    console.log('results', ins(r))
  }
}
