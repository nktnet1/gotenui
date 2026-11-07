import assert from 'node:assert/strict'
import { describe, it } from 'vitest'
import { parseGotenbergVersion } from '#/lib/gotenberg-version'
import {
  backendCompatibilityNotice,
  canWebhookForOperation,
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
      const reason = unavailableOperationReason(status('8.39.0'), tool)
      if (tool.supportedGotenbergMajors?.includes(8)) assert.equal(reason, null, tool.id)
      else assert.match(reason ?? '', /requires Gotenberg 9/, tool.id)
    }
    assert.match(unavailableOperationReason(status('8.35.0'), operation('optimize')) ?? '', /8\.36/)
  })

  it('gates by major version without assuming minor-version capabilities', () => {
    for (const tool of OPERATIONS) {
      assert.equal(unavailableOperationReason(status('9.1.0'), tool), null, tool.id)
      assert.equal(unavailableOperationReason(status('9.3.0'), tool), null, tool.id)
      assert.deepEqual(
        tool.supportedGotenbergMajors,
        tool.path.startsWith('/forms/pdf/') ? [9] : [8, 9],
        tool.id,
      )
    }
  })

  it('gates 9.1-only PDF extraction routes without blocking other v9 tools', () => {
    for (const id of ['extract-text', 'extract-attachments']) {
      assert.match(unavailableOperationReason(status('9.0.0'), operation(id)) ?? '', /9\.1/)
      assert.match(unavailableOperationReason(status('9.0.9'), operation(id)) ?? '', /9\.1/)
      assert.equal(unavailableOperationReason(status('9.1.0'), operation(id)), null)
      assert.equal(unavailableOperationReason(status('9.2.0'), operation(id)), null)
    }
    for (const id of ['pdf-pipeline', 'pdf-info', 'html-pdf']) {
      assert.equal(unavailableOperationReason(status('9.0.0'), operation(id)), null)
    }
  })

  it('gates v8 PDF/A and Factur-X on LibreOffice but not the v9 PDF engine', () => {
    for (const toolId of ['pdfa', 'factur-x']) {
      assert.match(
        unavailableOperationReason(
          { ...status('8.40.0'), modules: [{ name: 'libreoffice', status: 'down' }] },
          operation(toolId),
        ) ?? '',
        /LibreOffice/,
      )
      assert.equal(
        unavailableOperationReason(
          { ...status('9.0.0'), modules: [{ name: 'libreoffice', status: 'down' }] },
          operation(toolId),
        ),
        null,
      )
    }
    assert.match(
      unavailableOperationReason(
        { ...status('9.0.0'), modules: [{ name: 'libreoffice', status: 'down' }] },
        operation('office-pdf'),
      ) ?? '',
      /LibreOffice/,
    )
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

  it('supports webhooks for v8 JSON reads but only non-JSON v9 operations', () => {
    for (const id of [
      'metadata-read',
      'bookmarks-read',
      'pdf-info',
      'pdf-validate',
      'pdf-attachments',
      'pdf-form',
    ]) {
      assert.equal(canWebhookForOperation(9, operation(id)), false, id)
      if (operation(id).supportedGotenbergMajors?.includes(8)) {
        assert.equal(canWebhookForOperation(8, operation(id)), true, id)
      }
    }
    assert.equal(canWebhookForOperation(9, operation('merge')), true)
    assert.equal(canWebhookForOperation(9, operation('url-shot')), true)
  })

  it('only shows a global notice for an unknown or unsupported version', () => {
    assert.equal(backendCompatibilityNotice(status('8.39.0')), null)
    assert.equal(backendCompatibilityNotice(status('9.0.0')), null)
    assert.match(backendCompatibilityNotice(status('Unknown')) ?? '', /could not verify/)
    assert.match(backendCompatibilityNotice(status('10.0.0')) ?? '', /not supported/)
    assert.equal(backendCompatibilityNotice({ ...status('9.0.0'), online: false }), null)
  })
})
