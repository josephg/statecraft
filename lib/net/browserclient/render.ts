import html from 'nanohtml'

export default function render(mimetype: string, obj: any) {
  switch (mimetype) {
    case 'image/png':
    case 'image/jpeg':
      return html`<img src="data:${mimetype};base64,${obj.toString('base64')}">`

    case 'application/json':
      return html`<pre>${JSON.stringify(obj, null, 2)}</pre>`
    
    default:
      throw Error('Unknown mimetype ' + mimetype)
  }
}