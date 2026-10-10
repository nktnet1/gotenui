import { cp, mkdir, rm, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const sourceCandidates = ['dist/client', '.output/public']
let source
let html
for (const path of sourceCandidates) {
  for (const file of ['index.html', '_shell.html']) {
    try {
      if ((await stat(join(path, file))).isFile()) {
        source = path
        html = file
        break
      }
    } catch {
      // The current TanStack build adapter did not write to this location.
    }
  }
  if (source) break
}
if (!source) {
  throw new Error(
    'No static TanStack SPA shell was produced (checked dist/client and .output/public).',
  )
}
await rm('static', { recursive: true, force: true })
await mkdir('static', { recursive: true })
await cp(source, resolve('static'), { recursive: true })
if (html === '_shell.html') await cp(join(source, '_shell.html'), resolve('static/index.html'))
console.log(`Static, deployable site ready at static/ (copied from ${source}).`)
