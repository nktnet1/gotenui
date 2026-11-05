import assert from 'node:assert/strict'
import { describe, it } from 'vitest'
import { parseGotenbergVersion } from '#/lib/gotenberg-version'
import {
  backendCompatibilityNotice,
  unavailableOperationReason,
  versionAtLeast,
} from '#/lib/operation-availability'
import { OPERATION_BY_ID, OPERATIONS } from '#/tools/registry'

const operation = (id: string) => {
  const result = OPERATION_BY_ID.get(id)
  assert.ok(result)
  return result
}

const status = (version: string) => ({ online: true, version, modules: [] })

describe('Gotenberg major-version detection', () => {
  it.each([
    ['8.27.0', { major: 8, minor: 27, patch: 0 }],
    ['v8.39.0', { major: 8, minor: 39, patch: 0 }],
    ['9.0.0', { major: 9, minor: 0, patch: 0 }],
    ['v9.2.1-rc.3+build.4', { major: 9, minor: 2, patch: 1 }],
    ['8.36', { major: 8, minor: 36, patch: 0 }],
    ['10.0.0', { major: 10, minor: 0, patch: 0 }],
  ])('parses %s', (input, expected) => {
    assert.deepEqual(parseGotenbergVersion(input), expected)
  })

  it.each([undefined, '', 'Unknown', 'Unavailable', 'Gotenberg 9.0.0', '9', '9.0oops', '9.0.0 '])(
    'does not guess versions from %s',
    (input) => {
      assert.equal(parseGotenbergVersion(input), null)
    },
  )

  it('retains Gotenberg 8-specific feature gates', () => {
    assert.equal(versionAtLeast('8.35.9', 36), false)
    assert.equal(versionAtLeast('v8.36.0', 36), true)
    assert.equal(versionAtLeast('9.0.0', 36), null)
    assert.equal(versionAtLeast('Unknown', 36), null)
  })
})

describe('per-operation API compatibility', () => {
  it('keeps all existing Gotenberg 8 tools enabled (subject to existing module/minor checks)', () => {
    for (const tool of OPERATIONS) {
      assert.equal(unavailableOperationReason(status('8.39.0'), tool), null, tool.id)
    }
    assert.match(unavailableOperationReason(status('8.35.0'), operation('optimize')) ?? '', /8\.36/)
  })

  it('permits the migrated Chromium and LibreOffice conversion routes on Gotenberg 9', () => {
    for (const tool of OPERATIONS) {
      const reason = unavailableOperationReason(status('9.0.0'), tool)
      if (
        [
          'url-shot',
          'html-shot',
          'markdown-shot',
          'url-pdf',
          'html-pdf',
          'markdown-pdf',
          'office-pdf',
        ].includes(tool.id)
      ) {
        assert.equal(reason, null, tool.id)
        assert.deepEqual(tool.supportedGotenbergMajors, [8, 9])
      } else {
        assert.match(reason ?? '', /not been migrated to Gotenberg 9/i, tool.id)
      }
    }
  })

  it('still requires healthy modules for shared v9 screenshots', () => {
    assert.match(
      unavailableOperationReason(
        { ...status('9.0.0'), modules: [{ name: 'chromium', status: 'down' }] },
        operation('url-shot'),
      ) ?? '',
      /Chromium/,
    )
    assert.equal(
      unavailableOperationReason(
        { ...status('9.0.0'), modules: [{ name: 'libreoffice', status: 'up' }] },
        operation('url-shot'),
      ),
      'The selected Gotenberg instance does not have a healthy Chromium module.',
    )
  })

  it('fails closed for unfamiliar and unparseable online versions but allows offline troubleshooting', () => {
    assert.match(
      unavailableOperationReason(status('10.0.0'), operation('url-shot')) ?? '',
      /not supported/i,
    )
    assert.match(
      unavailableOperationReason(status('Unknown'), operation('merge')) ?? '',
      /version/i,
    )
    assert.equal(
      unavailableOperationReason({ ...status('Unknown'), online: false }, operation('merge')),
      null,
    )
    assert.equal(unavailableOperationReason(null, operation('merge')), null)
  })

  it('shows an honest global compatibility notice', () => {
    assert.equal(backendCompatibilityNotice(status('8.39.0')), null)
    assert.match(
      backendCompatibilityNotice(status('9.0.0')) ?? '',
      /Chromium and LibreOffice conversions, plus screenshots, are available/,
    )
    assert.match(backendCompatibilityNotice(status('Unknown')) ?? '', /could not verify/)
    assert.match(backendCompatibilityNotice(status('10.0.0')) ?? '', /not supported/)
    assert.equal(backendCompatibilityNotice({ ...status('9.0.0'), online: false }), null)
  })
})
