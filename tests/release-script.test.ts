import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'vitest'

const root = fileURLToPath(new URL('../', import.meta.url))
const { version } = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as {
  version: string
}

test('release CLI exports prerelease status for GitHub Actions', () => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'gotenui-release-')))
  try {
    const output = join(directory, 'github-output')
    const result = spawnSync(process.execPath, ['scripts/validate-release-tag.ts', `v${version}`], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, GITHUB_OUTPUT: output },
    })
    assert.equal(result.status, 0, result.stderr)
    assert.equal(readFileSync(output, 'utf8'), `prerelease=${version.includes('-')}\n`)
    assert.match(result.stdout, /Validated release tag/)
  } finally {
    rmSync(directory, { force: true, recursive: true })
  }
})

test('release CLI rejects a tag that disagrees with package.json', () => {
  const result = spawnSync(process.execPath, ['scripts/validate-release-tag.ts', 'v999.999.999'], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, GITHUB_OUTPUT: '' },
  })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /does not match package.json/)
})
