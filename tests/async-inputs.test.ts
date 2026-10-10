import assert from 'node:assert/strict'
import { test } from 'vitest'
import {
  emptyWebhook,
  type RemoteInputRow,
  remoteInputsPayload,
  safeOutboundHost,
  webhookPayload,
} from '#/lib/async-inputs'
import { createGotenbergForm } from '#/lib/gotenberg-client'
import { OPERATION_BY_ID } from '#/lib/operations'
import { validatePayload } from '#/lib/validation'

function remoteRow(overrides: Partial<RemoteInputRow> = {}): RemoteInputRow {
  return {
    id: 1,
    url: 'https://files.example.test/input.docx',
    field: '',
    headers: [],
    ...overrides,
  }
}

function validated(operation: string, extras: Record<string, unknown>) {
  return validatePayload({ operation, fields: {}, advanced: {}, ...extras })
}

test('structured remote descriptors preserve order, destination, and per-file headers', () => {
  const descriptors = remoteInputsPayload(
    [
      remoteRow({
        headers: [{ id: 2, name: 'Authorization', value: 'Bearer secret-download-token' }],
      }),
      remoteRow({ id: 3, field: 'embedded', url: 'https://files.example.test/attachment.txt' }),
      remoteRow({ id: 4, field: 'watermark', url: 'https://files.example.test/overlay.png' }),
      remoteRow({ id: 5, field: 'stamp', url: 'https://files.example.test/stamp.pdf' }),
    ],
    '',
  )
  const { payload } = validated('office-pdf', { downloadFrom: descriptors })
  assert.deepEqual(payload.downloadFrom, [
    {
      url: 'https://files.example.test/input.docx',
      extraHttpHeaders: { Authorization: 'Bearer secret-download-token' },
    },
    { url: 'https://files.example.test/attachment.txt', field: 'embedded' },
    { url: 'https://files.example.test/overlay.png', field: 'watermark' },
    { url: 'https://files.example.test/stamp.pdf', field: 'stamp' },
  ])
})

test('structured remote inputs serialize without changing the upstream form contract', () => {
  const { payload, operation } = validated('office-pdf', {
    downloadFrom: remoteInputsPayload([remoteRow()], ''),
  })
  assert.equal(OPERATION_BY_ID.get('office-pdf'), operation)
  const form = createGotenbergForm(operation, payload, [], [])
  assert.deepEqual(JSON.parse(String(form.get('downloadFrom'))), payload.downloadFrom)
  assert.equal(form.getAll('files').length, 0)
})

test('legacy downloadFrom JSON remains supported but cannot override structured rows', () => {
  const legacy = '[{"url":"https://files.example.test/legacy.docx","embedded":false}]'
  assert.deepEqual(remoteInputsPayload([], legacy), JSON.parse(legacy))
  assert.throws(() => remoteInputsPayload([remoteRow()], legacy), /not both/)
  assert.throws(() => remoteInputsPayload([], '{bad'), /valid JSON/)
  assert.equal(remoteInputsPayload([], ''), undefined)
})

test('outbound header editing rejects incomplete and case-insensitive duplicate names', () => {
  for (const headers of [
    [{ id: 1, name: '', value: 'secret' }],
    [{ id: 1, name: 'X-Api-Key', value: '' }],
    [
      { id: 1, name: 'X-Api-Key', value: 'a' },
      { id: 2, name: 'x-api-key', value: 'b' },
    ],
  ]) {
    assert.throws(() => remoteInputsPayload([remoteRow({ headers })], ''))
  }
  assert.throws(() =>
    validated('office-pdf', {
      downloadFrom: remoteInputsPayload(
        [remoteRow({ headers: [{ id: 1, name: 'Bad Header', value: 'x' }] })],
        '',
      ),
    }),
  )
  assert.throws(() =>
    validated('office-pdf', {
      downloadFrom: remoteInputsPayload(
        [remoteRow({ headers: [{ id: 1, name: 'X-Test', value: 'value\r\nInjected: yes' }] })],
        '',
      ),
    }),
  )
})

test('webhook editor maps optional URL/method/header fields to validated Gotenberg metadata', () => {
  const editor = {
    ...emptyWebhook,
    enabled: true,
    url: 'https://hooks.example.test/success',
    method: 'PUT' as const,
    errorUrl: 'https://hooks.example.test/error',
    errorMethod: 'PATCH' as const,
    eventsUrl: 'https://hooks.example.test/events',
    headers: [{ id: 1, name: 'Authorization', value: 'Bearer secret-callback-token' }],
  }
  const { payload } = validated('url-pdf', {
    fields: { url: 'https://example.test/' },
    webhook: webhookPayload(editor, ''),
  })
  assert.deepEqual(payload.webhook, {
    url: editor.url,
    method: 'PUT',
    errorUrl: editor.errorUrl,
    errorMethod: 'PATCH',
    eventsUrl: editor.eventsUrl,
    extraHttpHeaders: { Authorization: 'Bearer secret-callback-token' },
  })
  assert.deepEqual(webhookPayload({ ...editor, errorUrl: '' }, ''), {
    url: editor.url,
    method: 'PUT',
    eventsUrl: editor.eventsUrl,
    extraHttpHeaders: { Authorization: 'Bearer secret-callback-token' },
  })
  assert.equal(webhookPayload(emptyWebhook, ''), undefined)
  assert.throws(
    () => webhookPayload({ ...emptyWebhook, enabled: true, url: editor.url }, ''),
    /events or error callback URL/,
  )
})

test('webhook legacy JSON remains supported but cannot replace enabled editor settings', () => {
  const legacy = '{"url":"https://hooks.example.test/old"}'
  assert.deepEqual(webhookPayload(emptyWebhook, legacy), JSON.parse(legacy))
  assert.throws(() => webhookPayload({ ...emptyWebhook, enabled: true }, legacy), /not both/)
  assert.throws(() => webhookPayload(emptyWebhook, '{no'), /valid JSON/)
})

test('safe outbound preview hides credentials, pre-signed URLs, queries and fragments', () => {
  const secrets = ['token-in-path', 'query-secret', 'fragment-secret', 'user', 'password']
  const preview = safeOutboundHost(
    'https://user:password@files.example.test/token-in-path?key=query-secret#fragment-secret',
  )
  assert.equal(preview, 'https://files.example.test')
  for (const secret of secrets) assert.equal(preview.includes(secret), false)
  assert.equal(safeOutboundHost('javascript:alert(1)'), '(invalid URL)')
  assert.equal(safeOutboundHost('bad url'), '(invalid URL)')
})
