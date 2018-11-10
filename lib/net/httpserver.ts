import * as I from '../types/interfaces'
import http = require('http')

const id = <T>(x: T) => x

export interface HttpOpts {
  // Defaults to id.
  urlToKey?: (url: string) => I.Key,

  // Defaults to JSON stringifying everything.
  valToHttp?: (val: any, key: I.Key, req: http.IncomingMessage) => {
    mimeType: string,
    content: string | Buffer,
  }
}

const defaultOpts: HttpOpts = {
  urlToKey: id,
  valToHttp: (val: any) => ({
    mimeType: 'application/json',
    content: JSON.stringify({success: val != null, value: val})
  })
}

// This function should really return an express / connect Router or
// something.
export default function handler(store: I.Store, optsIn?: HttpOpts) {
  if (!store.storeInfo.capabilities.queryTypes.has('kv')) {
    throw Error('Httpserver needs kv support')
  }

  const opts = Object.assign({}, defaultOpts, optsIn)
  // const urlToKey = (opts && opts.urlToKey) ? opts.urlToKey : id
  // const valToHttp = (opts && opts.valToHttp) ? opts.valToHttp : toJson

  return async (req: http.IncomingMessage, res: http.ServerResponse) => {
    const key = opts.urlToKey!(req.url!)
    const result = await store.fetch({type: 'kv', q: new Set([key])})
    const value = result.results.get(key)
    // console.log('key', key, 'value', value, result)

    res.setHeader('x-sc-version', JSON.stringify(result.versions))

    const {mimeType, content} = opts.valToHttp!(value, key, req)

    res.setHeader('content-type', mimeType)
    res.writeHead(value == null ? 404 : 200)
    res.end(content)
  }
}