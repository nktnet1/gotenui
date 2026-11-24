import { describe, expect, test } from 'vitest'
import { emptyWebhook, type RemoteInputRow, remoteInputsPayload } from '#/lib/async-inputs'
import { createGotenbergForm } from '#/lib/gotenberg-client'
import { confirmedBackendVersion } from '#/lib/operation-availability'
import {
  outboundCompatibilityReasons,
  requestFieldCompatibilityReason,
} from '#/lib/request-compatibility'
import { validatePayload } from '#/lib/validation'
import { OPERATION_BY_ID } from '#/tools/registry'
import { draftOutboundIssues } from '#/tools/shared/draft-compatibility'

function operation(id: string) {
  const found = OPERATION_BY_ID.get(id)
  if (!found) throw new Error(`Unknown operation ${id}`)
  return found
}
const v8 = { major: 8, minor: 40, patch: 0 }
const v91 = { major: 9, minor: 1, patch: 0 }
const v92 = { major: 9, minor: 2, patch: 0 }
const v910 = { major: 9, minor: 10, patch: 0 }
const row: RemoteInputRow = {
  id: 1,
  url: 'https://files.example.test/report.docx',
  filename: 'report.docx',
  filenameMode: 'override',
  field: '',
  headers: [{ id: 2, name: 'Authorization', value: 'Bearer private' }],
}
const draft = {
  remoteRows: [],
  remoteInput: '',
  webhookSettings: emptyWebhook,
  webhookInput: '',
  advanced: '',
}

describe('confirmed connection status', () => {
  test('only a recognised online version from the completed status check is actionable', () => {
    const online = { online: true, version: '9.10.0', modules: [] }
    expect(confirmedBackendVersion(online, false)).toBe('9.10.0')
    expect(confirmedBackendVersion(online, true)).toBeUndefined()
    expect(confirmedBackendVersion({ ...online, online: false }, false)).toBeUndefined()
    expect(confirmedBackendVersion({ ...online, version: 'Unknown' }, false)).toBeUndefined()
    expect(confirmedBackendVersion({ ...online, version: '10.0.0' }, false)).toBeUndefined()
    expect(confirmedBackendVersion(null, false)).toBeUndefined()
  })
})

describe('shared version preflight', () => {
  test('blocks a native v8-only option on v9 and retains supported legacy API aliases', () => {
    const office = operation('office-pdf')
    expect(requestFieldCompatibilityReason(office, v910, { firstPageOnLeft: true })).toMatch(
      /First page on left requires Gotenberg 8/,
    )
    expect(requestFieldCompatibilityReason(office, v8, { firstPageOnLeft: true })).toBeNull()
    expect(
      requestFieldCompatibilityReason(office, v910, { pdfa: 'PDF/A-2b', pdfua: true }),
    ).toBeNull()
    expect(requestFieldCompatibilityReason(office, v910, { openBookmarkLevels: '20' })).toMatch(
      /bookmark expansion/,
    )
    expect(requestFieldCompatibilityReason(office, v8, { openBookmarkLevels: '20' })).toBeNull()
    expect(requestFieldCompatibilityReason(operation('html-shot'), v910, { quality: '0' })).toMatch(
      /at least 1/,
    )
    expect(requestFieldCompatibilityReason(operation('html-shot'), v8, { quality: '0' })).toBeNull()
    expect(requestFieldCompatibilityReason(office, v92, { showTrackedChanges: false })).toMatch(
      /9\.10/,
    )
    expect(
      requestFieldCompatibilityReason(operation('merge'), v92, { v9FileBookmarks: false }),
    ).toBeNull()
  })

  test('keeps a downloaded filename override distinct from a legacy hint', () => {
    const spec = operation('office-pdf')
    const override = remoteInputsPayload([row], '')
    const hint = remoteInputsPayload([{ ...row, filenameMode: 'hint' }], '')
    expect(override).toEqual([
      {
        url: row.url,
        filename: 'report.docx',
        extraHttpHeaders: { Authorization: 'Bearer private' },
      },
    ])
    expect(hint).toEqual([
      { url: row.url, name: 'report.docx', extraHttpHeaders: { Authorization: 'Bearer private' } },
    ])
    const validated = (downloadFrom: unknown) =>
      validatePayload({ operation: spec.id, fields: {}, advanced: {}, downloadFrom }).payload
    expect(outboundCompatibilityReasons(spec, v91, validated(override))).toEqual([
      'downloadFrom filename overrides require Gotenberg 9.2 or newer.',
    ])
    expect(outboundCompatibilityReasons(spec, v8, validated(override))).toHaveLength(1)
    expect(outboundCompatibilityReasons(spec, v92, validated(override))).toEqual([])
    expect(outboundCompatibilityReasons(spec, v91, validated(hint))).toEqual([])
    const encoded = (downloadFrom: unknown, version: typeof v91) =>
      JSON.parse(
        String(
          createGotenbergForm(
            spec,
            validated(downloadFrom),
            [],
            [],
            4_000_000,
            {},
            [],
            9,
            version,
          ).get('downloadFrom'),
        ),
      )
    expect(encoded(override, v92)).toEqual(override)
    expect(encoded(hint, v91)).toEqual([
      { url: row.url, extraHttpHeaders: { Authorization: 'Bearer private' } },
    ])
    expect(() => encoded(override, v91)).toThrow(/9\.2 or newer/)
  })

  test('detects both structured and raw remote incompatibilities without changing the draft', () => {
    const spec = operation('office-pdf')
    expect(draftOutboundIssues(spec, {}, '9.1.0', { ...draft, remoteRows: [row] })).toEqual([
      'downloadFrom filename overrides require Gotenberg 9.2 or newer.',
    ])
    expect(draftOutboundIssues(spec, {}, '9.2.0', { ...draft, remoteRows: [row] })).toEqual([])
    expect(draftOutboundIssues(spec, {}, undefined, { ...draft, remoteRows: [row] })).toEqual([])
    expect(row.filenameMode).toBe('override')
    expect(
      draftOutboundIssues(spec, {}, '9.1.0', {
        ...draft,
        remoteInput: JSON.stringify([{ url: row.url, filename: 'report.docx' }]),
      }),
    ).toEqual(['downloadFrom filename overrides require Gotenberg 9.2 or newer.'])
    expect(
      draftOutboundIssues(spec, {}, '9.10.0', {
        ...draft,
        remoteRows: [{ ...row, field: 'embedded' }],
      })[0],
    ).toMatch(/Remote attachment and overlay/)
    expect(draftOutboundIssues(spec, {}, '9.10.0', { ...draft, remoteInput: '{bad' })[0]).toMatch(
      /valid JSON/,
    )
  })

  test('surfaces webhook and Advanced JSON problems before submission', () => {
    const spec = operation('html-pdf')
    const webhookSettings = {
      ...emptyWebhook,
      enabled: true,
      url: 'https://hooks.example.test/success',
      errorUrl: 'https://hooks.example.test/error',
    }
    expect(draftOutboundIssues(spec, {}, '8.40.0', { ...draft, webhookSettings })).toEqual([])
    expect(draftOutboundIssues(spec, {}, '9.10.0', { ...draft, webhookSettings })).toEqual([
      'Gotenberg 9 webhooks require an events callback URL.',
      'Gotenberg 9 removed the separate webhook error callback.',
    ])
    expect(
      draftOutboundIssues(spec, {}, '9.10.0', {
        ...draft,
        advanced: '{"waitForExpression":"true"}',
      })[0],
    ).toMatch(/Unsupported advanced field/)
    expect(draftOutboundIssues(spec, {}, '9.10.0', { ...draft, advanced: '{bad' })[0]).toMatch(
      /valid JSON/,
    )
    expect(draftOutboundIssues(spec, {}, '9.10.0', { ...draft, advanced: '{}' })).toEqual([])
    expect(
      draftOutboundIssues(operation('merge'), {}, '9.10.0', {
        ...draft,
        advanced: '{"customOption":true}',
      })[0],
    ).toMatch(/advanced PDF fields cannot be passed/)
    expect(
      draftOutboundIssues(operation('merge'), {}, '8.40.0', {
        ...draft,
        advanced: '{"customOption":true}',
      }),
    ).toEqual([])
  })
})

test('known incompatible raw multipart aliases are reported during preflight', () => {
  const spec = operation('office-pdf')
  expect(
    draftOutboundIssues(spec, {}, '8.40.0', { ...draft, advanced: '{"nativeQuality":80}' }),
  ).toEqual([
    'Advanced field nativeQuality requires Gotenberg 9. Use the corresponding tool setting instead.',
  ])
  expect(
    draftOutboundIssues(spec, {}, '9.10.0', { ...draft, advanced: '{"nativeQuality":80}' }),
  ).toEqual([])
  expect(
    draftOutboundIssues(spec, { quality: '70' }, '9.10.0', {
      ...draft,
      advanced: '{"nativeQuality":80}',
    }),
  ).toEqual(['Use either quality or nativeQuality, not both.'])
  expect(
    draftOutboundIssues(spec, {}, '9.10.0', { ...draft, advanced: '{"flatten":true}' }),
  ).toEqual(['Advanced field flatten requires a PDF stage on Gotenberg 9.'])
  expect(
    draftOutboundIssues(spec, {}, '8.40.0', { ...draft, advanced: '{"flatten":true}' }),
  ).toEqual([])
})

test.each([
  ['html-shot', 'nativeBookmarks'],
  ['html-shot', 'nativePages'],
  ['html-pdf', 'nativeQuality'],
  ['office-pdf', 'waitForWindowStatus'],
  ['html-pdf', 'nativePdfa'],
] as const)('rejects %s Advanced JSON alias %s on the wrong route', (id, name) => {
  const spec = operation(id)
  expect(
    draftOutboundIssues(spec, {}, '9.10.0', {
      ...draft,
      advanced: JSON.stringify({ [name]: 'value' }),
    }),
  ).toEqual([`Advanced field ${name} is not supported for ${spec.title}.`])
})

test.each([
  { pdfaProfile: 'PDF/A-3b' },
  { pdfuaProfile: 'PDF/UA-1' },
  { pdfa: 'PDF/A-2b' },
  { pdfua: true },
  { pdfaMethod: 'remediate' },
  { v9Language: 'en-AU' },
] as Record<string, string | boolean>[])(
  'rejects raw native conformance alongside UI settings %j',
  (fields) => {
    const spec = operation('office-pdf')
    expect(
      outboundCompatibilityReasons(spec, v910, {
        fields,
        advanced: { nativePdfa: 'PDF/A-2b' },
      }),
    ).toEqual([
      'Choose either nativePdfa/nativePdfua in Advanced JSON or the Office PDF conformance settings, not both.',
    ])
  },
)

test('raw native profiles remain usable on their own and supported aliases stay route-specific', () => {
  expect(
    draftOutboundIssues(operation('office-pdf'), {}, '9.10.0', {
      ...draft,
      advanced: '{"nativePdfua":"PDF/UA-1"}',
    }),
  ).toEqual([])
  expect(
    draftOutboundIssues(operation('html-pdf'), {}, '9.10.0', {
      ...draft,
      advanced: '{"nativePages":"1-2"}',
    }),
  ).toEqual([])
  expect(
    draftOutboundIssues(operation('html-shot'), {}, '9.10.0', {
      ...draft,
      advanced: '{"waitForWindowStatus":"ready"}',
    }),
  ).toEqual([])
})
