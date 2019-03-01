# Contentful Graphql demo

This is a blog which uses data from contentful and serves it through a graphql rendering function.

The blog content is stored in contentful, and we use the contentful streaming API to pull down changes into an in-memory store as they happen. The data is run through a map-reduce to render, and the HTML is served straight out of memory.