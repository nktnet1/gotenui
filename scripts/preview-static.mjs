import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, resolve, sep } from 'node:path'
import { styleText } from 'node:util'

const root = resolve('static')
const port = Number(process.env.PORT ?? 3100)
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
}
const server = createServer(async (request, response) => {
  try {
    const path = new URL(request.url ?? '/', 'http://localhost').pathname
    const requested = resolve(root, `.${decodeURIComponent(path)}`)
    if (requested !== root && !requested.startsWith(`${root}${sep}`)) {
      response.writeHead(403).end('Forbidden')
      return
    }
    let filename = requested
    try {
      if (!(await stat(filename)).isFile()) filename = resolve(root, 'index.html')
    } catch {
      filename = resolve(root, 'index.html')
    }
    if (filename === resolve(root, 'index.html') && path !== '/' && extname(path)) {
      response.writeHead(404).end('Not found')
      return
    }
    response.writeHead(200, {
      'Content-Type': mime[extname(filename)] ?? 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
    })
    createReadStream(filename).pipe(response)
  } catch {
    response.writeHead(500).end('Unable to serve static site')
  }
})
server.listen(port, '127.0.0.1', () => {
  console.log(`Static preview available at ${styleText('cyan', `http://localhost:${port}`)}`)
})
