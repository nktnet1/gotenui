import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'vitest'

const root = new URL('../', import.meta.url)
const release = readFileSync(new URL('.github/workflows/release.yml', root), 'utf8')
const ci = readFileSync(new URL('.github/workflows/ci.yml', root), 'utf8')

test('release workflow is exclusively tag-driven and requires a version match', () => {
  assert.match(release, /push:\s+tags:\s+- ['"]v\*['"]/)
  assert.doesNotMatch(release, /workflow_dispatch:/)
  assert.match(release, /node scripts\/validate-release-tag\.ts/)
  assert.match(release, /git merge-base --is-ancestor HEAD/)
})

test('release reuses both CI jobs before it publishes any container', () => {
  assert.match(ci, /workflow_call:/)
  assert.match(ci, /branches:\s+- ['"]\*\*['"]/)
  assert.match(release, /needs: verify\s+uses: \.\/\.github\/workflows\/ci\.yml/)
  assert.match(release, /needs: \[verify, ci\]/)
  assert.match(release, /needs: \[verify, publish\]/)
})

test('release publishes only to GHCR and requires scoped package permissions', () => {
  assert.match(release, /ghcr\.io\/\$\{GITHUB_REPOSITORY,,\}/)
  assert.match(release, /packages: write/)
  assert.match(release, /contents: write/)
  assert.match(release, /platforms: linux\/amd64,linux\/arm64/)
  assert.match(release, /provenance: mode=max/)
  assert.match(release, /sbom: true/)
  assert.match(release, /type=semver,pattern=\{\{version\}\}/)
  assert.match(release, /--generate-notes/)
  assert.match(release, /--prerelease --latest=false/)
})
