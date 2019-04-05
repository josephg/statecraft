// import {graphql, buildSchema, GraphQLFieldResolver} from 'graphql'
import * as gql from 'graphql'
import * as gqlTools from 'graphql-tools'

import kvStore from './stores/kvmem'
import doTxn, {Transaction} from './transaction'
import express from 'express'
import graphqlHTTP from 'express-graphql'
import {inspect} from 'util'

process.on('unhandledRejection', err => { throw err })



const schema = gqlTools.makeExecutableSchema({
  typeDefs: `
    type Post {
      title: String,
      content: String,
      author: Author,
    }

    type Author {
      fullName: String,
    }

    type Query {
      postById(id: String!): Post
      foo: String,
    }
  `,
  resolvers: {
    Post: {
      author(post, args, {txn}: {txn: Transaction}) {
        return txn.get('authors/' + post.author)
      }
    },

    Query: {
      postById: async (self, {id}: {id: string}, {txn}: {txn: Transaction}) => {
        console.log('id', id)
        const post = await txn.get('posts/' + id)
        console.log('post', post)
        return post
      }
    }
  }
})




;(async () => {
  const store = await kvStore(new Map<string, any>([
      ['authors/auth', {fullName: 'Seph'}],
      ['posts/post1', {title: 'Yo', content: 'omg I am clever', author: 'auth'}],
  ]))

  const res = await doTxn(store, async txn => (
    await gql.graphql(schema, `{postById(id: "post1") {title, author {fullName}}}`, null, {txn})
  ))
  console.log(inspect(res, {depth: null, colors: true}))

  // const app = express()
  // app.use('/graphql', graphqlHTTP({
  //   graphiql: true,
  //   schema,
  //   rootValue: root,
  // }))
})()
