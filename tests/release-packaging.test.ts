import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'vitest'

const root = new URL('../', import.meta.url)
const dockerfile = readFileSync(new URL('Dockerfile', root), 'utf8')
const ignore = readFileSync(new URL('.dockerignore', root), 'utf8')
const manifest = JSON.parse(readFileSync(new URL('package.json', root), 'utf8')) as {
  packageManager: string
  engines: { node: string }
}

test('production Docker build uses the project pnpm lockfile and Node 24', () => {
  assert.match(manifest.packageManager, /^pnpm@12\./)
  assert.equal(manifest.engines.node, '>=24')
  assert.match(dockerfile, /^FROM node:24-alpine AS build$/m)
  assert.match(dockerfile, /^COPY package\.json pnpm-lock\.yaml pnpm-workspace\.yaml \.\/$/m)
  assert.match(dockerfile, /^RUN corepack enable && pnpm install --frozen-lockfile$/m)
  assert.match(dockerfile, /^RUN pnpm build$/m)
  assert.doesNotMatch(dockerfile, /^RUN npm (?:install|ci|run)\b/m)
})

test('production runtime ships only Nitro output and does not run as root', () => {
  assert.match(dockerfile, /^FROM node:24-alpine$/m)
  assert.match(dockerfile, /^COPY --from=build --chown=node:node \/app\/\.output \.\/\.output$/m)
  assert.match(dockerfile, /^USER node$/m)
  assert.match(dockerfile, /^CMD \["node", "\.output\/server\/index\.mjs"\]$/m)
  assert.doesNotMatch(dockerfile, /^COPY --from=build \/app\/(?:node_modules|src)\b/m)
})

test('container build context excludes secrets, dependencies, Git history and patches', () => {
  const excluded = new Set(ignore.split(/\r?\n/).map((line) => line.trim()))
  for (const entry of [
    'node_modules',
    '.output',
    '.env',
    '.env.*',
    '.git',
    '.github',
    '*.patch',
    '*.bundle',
  ]) {
    assert.ok(excluded.has(entry), `Missing Docker context exclusion: ${entry}`)
  }
})
