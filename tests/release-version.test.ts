import assert from 'node:assert/strict'
import { test } from 'vitest'
import { validateReleaseTag } from '../scripts/release-version'

test.each(['v0.1.0', 'v1.2.3', 'v10.20.30'])('accepts stable release tag %s', (tag) => {
  assert.deepEqual(validateReleaseTag(tag, tag.slice(1)), {
    version: tag.slice(1),
    prerelease: false,
  })
})

test.each(['v0.2.0-rc.1', 'v1.2.3-alpha.0', 'v1.2.3-0', 'v1.2.3-beta-2.12'])(
  'accepts prerelease tag %s without marking it as stable',
  (tag) => {
    assert.deepEqual(validateReleaseTag(tag, tag.slice(1)), {
      version: tag.slice(1),
      prerelease: true,
    })
  },
)

test.each([
  'v1.2',
  'v1.2.3.4',
  '1.2.3',
  'V1.2.3',
  'v01.2.3',
  'v1.02.3',
  'v1.2.03',
  'v1.2.3-',
  'v1.2.3-01',
  'v1.2.3-rc.01',
  'v1.2.3-rc..1',
  'v1.2.3-rc/1',
  'v1.2.3+build.1',
  'v1.2.3-rc.1+build.1',
  `v1.2.3-${'a'.repeat(130)}`,
])('rejects invalid or unpublishable release tag %s', (tag) => {
  assert.throws(() => validateReleaseTag(tag, tag.slice(1)), /Invalid release tag/)
})

test('rejects a release tag that does not match package.json', () => {
  assert.throws(() => validateReleaseTag('v1.2.3', '1.2.4'), /does not match package.json/)
})
