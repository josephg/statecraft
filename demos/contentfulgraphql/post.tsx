import React, { ReactElement } from 'react'
import commonmark from 'commonmark'

const renderMarkdown = (content: string) => {
  const parser = new commonmark.Parser({smart: true})
  const writer = new commonmark.HtmlRenderer({smart: true, safe: true})
  
  const tree = parser.parse(content)
  return {__html: writer.render(tree)}
}

export default function MyComponent({updatedAt, title, content, author: {fullName}}: any): ReactElement {
  console.log('updat', updatedAt)
  return <html>
    <head>
      <title>{title}</title>
      <link rel="stylesheet" type="text/css" href="/style.css" />
    </head>
    <div>
      <h1>{title}</h1>
      <p dangerouslySetInnerHTML={renderMarkdown(content)} />
    </div>
    <div className='footer'>{fullName} / {(new Date(updatedAt)).toLocaleDateString()}</div>
  </html>
}
