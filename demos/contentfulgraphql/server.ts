import * as fs from 'fs'
import http from 'http'
import express from 'express'
import * as gql from 'graphql'
import * as gqlTools from 'graphql-tools'

import * as I from '../../lib/interfaces'
import createContentful from '../../lib/stores/contentful';
import kvMem from '../../lib/stores/kvmem'
import gqlmr, {Ctx} from '../../lib/stores/graphqlmapreduce'
import augment from '../../lib/augment'
import sel from '../../lib/sel'
import subValues from '../../lib/subvalues';
import {Console} from 'console'

// For debugging
import router, {ALL} from '../../lib/stores/router'
import serveTCP from '../../lib/net/tcpserver'

import Post from './post'
import {renderToString} from 'react-dom/server'
import fresh from 'fresh'
import { vRangeFrom } from '../../lib/version';


process.on('unhandledRejection', err => {
  console.error(err.stack)
  process.exit(1)
})

global.console = new (Console as any)({
  stdout: process.stdout,
  stderr: process.stderr,
  inspectOptions: {depth: null}
})

// Eventually this will be autogenerated from the schema.
const schema = gqlTools.makeExecutableSchema({
  typeDefs: `
    type Post {
      title: String,
      content: String,
      author: Author!,
      slug: [String!],
      updatedAt: String,
    }

    type Author {
      fullName: String,
    }

    type Query {
      postById(id: String!): Post
      foo: String,

      selfPost: Post,
      selfAuthor: Author,
    }
  `,
  resolvers: {
    Post: {
      author: (post, args, {txn}: Ctx) => (
        txn.get('author/' + post.author)
      )
    },

    Query: {
      postById: (_, {id}: {id: string}, {txn}: Ctx) => (
        txn.get('post/' + id)
      ),

      selfPost: (_self, _args, {Post}) => Post,
    }
  }
})

const genEtag = (versions: I.FullVersion): string => {
  return versions.map(v => v == null ? '' : Buffer.from(v).toString('base64')).join('.')
}

;(async () => {
  const keys = JSON.parse(fs.readFileSync('keys.json', 'utf8'))
  const syncStore = await kvMem()
  const ops = createContentful(syncStore, {
    space: keys.space,
    accessToken: keys.contentAPI,
  })
  // Ideally this wouldn't return until after we get the initial sync.
  const cfstore = augment(await kvMem(undefined, {inner: ops}))

  const store = await gqlmr(cfstore, {
    schema,
    mapReduces: [
      {
        type: 'Post',
        queryStr: `{selfPost {updatedAt, title, content, slug, author {fullName}}}`,
        reduce: ({selfPost}) => (
          renderToString(Post(selfPost))
        ),
        getOutputKey: (k, {selfPost}) => (`${selfPost.slug[0]}`)
      }
    ],
    prefixForCollection: new Map([
      // This is mapping graphql types -> backend key prefixes.
      ['Post', 'post/'],
      ['Author', 'author/'],
    ]),
  })

  const app = express()
  app.use(express.static(`${__dirname}/public`))

  app.get('/post/:slug', async (req, res, next) => {
    const r = await store.fetch({type: 'kv', q: new Set([req.params.slug])})
    const html = r.results.get(req.params.slug)
    if (html == null) return next()
    else {
      // TODO: ETag, etc.
      const headers = {
        'content-type': 'text/html',
        'etag': genEtag(vRangeFrom(r.versions)),
      }
      if (fresh(req.headers, headers)) return res.sendStatus(304)

      res.set(headers)
      res.send('<!doctype html>\n' + html)
    }
  })

  const server = http.createServer(app)
  const port = process.env['PORT'] || 2004
  server.listen(port, () => {
    console.log('listening on port', port)
  })

  if (process.env.NODE_ENV !== 'production') {
    const all = router<any>()
    all.mount(cfstore, 'cf/', null, '', false)
    all.mount(store, 'rendered/', null, '', false)
    const tcpServer = serveTCP(all)
    tcpServer.listen(2002, 'localhost')
    console.log('Debugging server listening on tcp://localhost:2002')
  }
})()