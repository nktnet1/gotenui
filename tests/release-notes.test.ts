import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'vitest'
import {
  buildReleaseBody,
  readReleaseChangelog,
  validateReleaseChangelog,
} from '../scripts/release-notes'

const root = fileURLToPath(new URL('../', import.meta.url))
const { version } = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as { version: string }
const tag = `v${version}`
const image = 'ghcr.io/example/gotenui'
const digest = `sha256:${'a'.repeat(64)}`

test('has a nonempty, correctly headed changelog for the current application version', () => {
  const notes = readReleaseChangelog(tag)
  assert.match(notes, new RegExp(`^# ${tag.replaceAll('.', '\\.')}$`, 'm'))
  assert.match(notes, /## Highlights/)
})

test('validates changelog headings and refuses empty notes and invalid tags', () => {
  assert.equal(
    validateReleaseChangelog('v1.2.3-rc.1', '# v1.2.3-rc.1\n\nNotes'),
    '# v1.2.3-rc.1\n\nNotes',
  )
  assert.throws(() => validateReleaseChangelog('v1.2.3', ''), /empty/)
  assert.throws(() => validateReleaseChangelog('v1.2.3', '  \n  '), /empty/)
  assert.throws(() => validateReleaseChangelog('v1.2.3', '# v1.2.2\nNotes'), /must start with/)
  assert.throws(() => validateReleaseChangelog('v1.2.3', '# v1.2.3'), /must describe changes/)
  assert.throws(
    () => validateReleaseChangelog('v1.2.3', '# v1.2.3\n## Highlights'),
    /must describe changes/,
  )
  assert.throws(() => validateReleaseChangelog('../secret', '# ../secret'), /Invalid release tag/)
  assert.throws(() => readReleaseChangelog('v999.999.999'), /Missing changelogs/)
})

test('appends the immutable GHCR image digest without changing the changelog', () => {
  assert.equal(
    buildReleaseBody('# v1.2.3\n\n- Fix\n', image, digest),
    `# v1.2.3\n\n- Fix\n\n## Container image\n\n\`${image}@${digest}\`\n`,
  )
  assert.throws(() => buildReleaseBody('notes', 'example.com/repo', digest), /Invalid GHCR/)
  assert.throws(() => buildReleaseBody(' ', image, digest), /changelog is empty/)
  assert.throws(() => buildReleaseBody('notes', image, 'sha256:bad'), /Invalid published image/)
})

test('prepares the GitHub Release notes file from the checked-in changelog', () => {
  const temporary = realpathSync(mkdtempSync(join(tmpdir(), 'gotenui-notes-')))
  try {
    const result = spawnSync(process.execPath, ['scripts/prepare-release-notes.ts'], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, TAG: tag, IMAGE: image, DIGEST: digest, RUNNER_TEMP: temporary },
    })
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /Prepared/)
    assert.equal(
      readFileSync(join(temporary, 'gotenui-release-notes.md'), 'utf8'),
      buildReleaseBody(readReleaseChangelog(tag), image, digest),
    )
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
})

test('fails rather than preparing a release without a changelog', () => {
  const temporary = realpathSync(mkdtempSync(join(tmpdir(), 'gotenui-notes-missing-')))
  try {
    const result = spawnSync(process.execPath, ['scripts/prepare-release-notes.ts'], {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        TAG: 'v999.999.999',
        IMAGE: image,
        DIGEST: digest,
        RUNNER_TEMP: temporary,
      },
    })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /Missing changelogs/)
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
})
