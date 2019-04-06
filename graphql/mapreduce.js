
// Given a schema..

const schema = buildSchema(`
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
  }
`)

const store = augment(kvStore(new Map<string, any>([
    ['auth', {fullName: 'Seph'}],
    ['post1', {title: 'Yo', content: 'omg I am clever', author: 'auth'}],
])))


// Might also need to pass a map-reduce function version number, so we know when to regenerate stuff.
const fullposts = gqlMapReduce(store, schema, 'Post', gql`{title, author {fullName} }`, post => {
  // Or whatever. The fields named by the graphql query are tagged.
  return `Post ${post.title} author ${post.author.fullName}`
})


////

// Also need a structured way to slurp up the contents of a store into another local store. LMDB would be good here

