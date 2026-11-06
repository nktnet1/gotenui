import assert from 'node:assert/strict'
import { describe, it } from 'vitest'
import { adaptPdfForm } from '#/lib/gotenberg-pdf-adapter'
import { parsePdfValidationReport } from '#/lib/pdf-validation-report'
import { type ConversionPayload, validatePayload } from '#/lib/validation'
import { OPERATION_BY_ID, operationDefaults } from '#/tools/registry'
import { V9_PDF_IDS } from '#/tools/v9-pdf-config'

function request(
  id: string,
  updates: Record<string, string | boolean> = {},
  auxiliary: File[] = [],
  advanced: ConversionPayload['advanced'] = {},
) {
  const operation = OPERATION_BY_ID.get(id)
  assert.ok(operation, id)
  const fields = { ...operationDefaults(operation), ...updates }
  const payload: ConversionPayload = { operation: id, fields, advanced }
  const legacy = new FormData()
  legacy.append('files', new File(['%PDF-1.7\n'], 'example.pdf'), 'example.pdf')
  return { operation, payload, legacy, auxiliary }
}

function adapted(
  id: string,
  fields: Record<string, string | boolean> = {},
  auxiliary: File[] = [],
) {
  const args = request(id, fields, auxiliary)
  const result = adaptPdfForm(args.operation, args.payload, args.legacy, 9, args.auxiliary)
  const stages = result.form.get('stages')
  return { ...result, stages: stages ? JSON.parse(String(stages)) : undefined }
}

describe('version-gated PDF tool catalogue', () => {
  it('adds processing, extraction and inspection endpoints on the supported v9 minor', () => {
    assert.equal(V9_PDF_IDS.size, 19)
    for (const id of V9_PDF_IDS) {
      const op = OPERATION_BY_ID.get(id)
      assert.deepEqual(op?.supportedGotenbergMajors, [9])
      assert.equal(op?.input, 'pdf')
      const args = request(id)
      assert.throws(() => adaptPdfForm(args.operation, args.payload, args.legacy, 8, []), {
        status: 409,
      })
    }
  })

  it('requires declared fields and rejects unknown ones before request adaptation', () => {
    assert.throws(
      () => validatePayload({ operation: 'select-pages', fields: {}, advanced: {} }),
      /Pages is required/,
    )
    assert.throws(
      () => validatePayload({ operation: 'select-pages', fields: { hidden: '1' }, advanced: {} }),
      /Unsupported field/,
    )
  })
})

describe('Gotenberg 9 read endpoints', () => {
  it.each([
    ['pdf-info', '/forms/pdf/info'],
    ['pdf-attachments', '/forms/pdf/attachments'],
    ['pdf-form', '/forms/pdf/form'],
  ])('maps %s to its JSON read route with an optional password', (id, route) => {
    const result = adapted(id, { password: 'secret' })
    assert.equal(result.path, route)
    assert.equal(result.form.get('password'), 'secret')
    assert.equal(result.form.get('stages'), null)
    assert.equal(result.form.getAll('files').length, 1)
  })

  it('maps optional form page filtering to the read endpoint', () => {
    assert.equal(adapted('pdf-form', { pages: '1-2,5' }).form.get('pages'), '1-2,5')
  })

  it('encodes validation profiles as repeated multipart fields', () => {
    const result = adapted('pdf-validate', {
      profile: 'PDF/A-4f',
      additionalProfile: 'PDF/UA-2',
      password: 'read-password',
    })
    assert.equal(result.path, '/forms/pdf/validate')
    assert.deepEqual(result.form.getAll('profile'), ['PDF/A-4f', 'PDF/UA-2'])
    assert.equal(result.form.get('password'), 'read-password')
    assert.equal(result.form.get('stages'), null)
  })

  it.each([
    { profile: 'PDF/A-4', additionalProfile: 'PDF/UA-1' },
    { profile: 'PDF/A-2a', additionalProfile: 'PDF/UA-2' },
    { profile: 'PDF/UA-1', additionalProfile: 'PDF/UA-1' },
    { profile: 'Factur-X', additionalProfile: 'PDF/UA-2' },
  ])('rejects incompatible conformance pairs: $profile + $additionalProfile', (fields) => {
    assert.throws(() => adapted('pdf-validate', fields), /additional PDF\/UA profile/)
  })
})

describe('Gotenberg 9 PDF stages', () => {
  it.each([
    ['select-pages', { pages: '2,1' }, { op: 'select', pages: '2,1' }],
    ['delete-pages', { pages: 'odd' }, { op: 'delete', pages: 'odd' }],
    ['flatten-transparency', {}, { op: 'flatten-transparency' }],
    ['convert-colors', { target: 'gray' }, { op: 'convert-colors', target: 'gray' }],
    ['autotag', {}, { op: 'autotag' }],
    ['detach', { attachmentName: 'report.csv' }, { op: 'detach', name: 'report.csv' }],
    ['decrypt', { password: 'secret' }, { op: 'decrypt', password: 'secret' }],
    [
      'timestamp',
      { timestampUrl: 'https://tsa.example.org/ts' },
      { op: 'timestamp', timestampUrl: 'https://tsa.example.org/ts' },
    ],
    [
      'render-pages',
      { format: 'jpeg', pages: '1', quality: '82', dpi: '150' },
      { op: 'render', format: 'jpeg', pages: '1', quality: 82, dpi: 150 },
    ],
  ] as const)('maps %s to a validated one-stage pipe', (id, fields, stage) => {
    const result = adapted(id, fields)
    assert.equal(result.path, '/forms/pdf/pipe')
    assert.deepEqual(result.stages, [stage])
  })

  it('normalises the timestamp authority for standalone timestamping and PAdES signing', () => {
    assert.deepEqual(
      adapted('timestamp', { timestampUrl: 'HTTPS://TSA.EXAMPLE.test:443/issue?key=1' }).stages,
      [{ op: 'timestamp', timestampUrl: 'https://tsa.example.test/issue?key=1' }],
    )
    assert.deepEqual(
      adapted('sign', { timestampUrl: 'HTTPS://TSA.EXAMPLE.test:443/issue?key=1' }, [
        new File(['certificate'], 'signer.p12'),
      ]).stages,
      [
        {
          op: 'sign',
          certificate: 'signer.p12',
          timestampUrl: 'https://tsa.example.test/issue?key=1',
        },
      ],
    )
  })

  it('inserts named PDF pages and uploads the source as a stage file', () => {
    const extra = new File(['%PDF-1.7\n'], 'insert.pdf')
    const result = adapted('insert-pages', { at: '1', sourcePages: '2-3' }, [extra])
    assert.deepEqual(result.stages, [
      { op: 'insert', source: 'insert.pdf', at: 1, sourcePages: '2-3' },
    ])
    assert.deepEqual(
      result.form.getAll('files').map((file) => (file instanceof File ? file.name : '')),
      ['example.pdf', 'insert.pdf'],
    )
    assert.throws(
      () => adapted('insert-pages', { at: '1' }, [new File(['duplicate'], 'example.pdf')]),
      /collides/,
    )
    assert.throws(() => adapted('insert-pages', { at: '-1' }, [extra]), /Insert position/)
    assert.throws(
      () => adapted('insert-pages', {}, [new File(['nope'], 'insert.txt')]),
      /additional PDF/,
    )
  })

  it('fills interactive fields only from a name-to-values JSON object', () => {
    const values = JSON.stringify({ 'Address.City': 'Sydney', 'Choices.List': ['one', 'two'] })
    assert.deepEqual(adapted('fill-form', { formValues: values }).stages, [
      { op: 'set-form', fields: { 'Address.City': 'Sydney', 'Choices.List': ['one', 'two'] } },
    ])
    for (const input of ['{}', '[]', '{"empty":4}', '{"null":null}', '{"items":[5]}']) {
      assert.throws(() => adapted('fill-form', { formValues: input }), /Form (field names|values)/)
    }
  })

  it('validates redaction coordinates and requires explicit confirmation', () => {
    const regions = JSON.stringify([{ page: 1, x: 48, y: 100, width: 150, height: 20 }])
    assert.deepEqual(adapted('redact', { regions, confirmRedaction: true }).stages, [
      { op: 'redact', regions: [{ page: 1, x: 48, y: 100, width: 150, height: 20 }] },
    ])
    assert.throws(() => adapted('redact', { regions }), /Confirm permanent redaction/)
    for (const invalid of [
      [{ page: 0, x: 1, y: 1, width: 3, height: 2 }],
      [{ page: 1, x: -1, y: 0, width: 3, height: 2 }],
      [{ page: 1, x: 1, y: 1, width: 0, height: 2 }],
      [{ page: 1, x: 1, y: 1, width: 3, height: 2, replaceWith: 'secret' }],
    ]) {
      assert.throws(
        () => adapted('redact', { regions: JSON.stringify(invalid), confirmRedaction: true }),
        /redaction region/,
      )
    }
  })

  it('requires signing credentials of a supported combination and maps optional fields', () => {
    const cert = new File(['certificate'], 'public.pem')
    const key = new File(['private key'], 'private.key')
    const result = adapted('sign', { reason: 'Reviewed', pades: true }, [cert, key])
    assert.deepEqual(result.stages, [
      {
        op: 'sign',
        certificate: 'public.pem',
        key: 'private.key',
        reason: 'Reviewed',
        pades: true,
      },
    ])
    assert.deepEqual(
      result.form.getAll('files').map((file) => (file instanceof File ? file.name : '')),
      ['example.pdf', 'public.pem', 'private.key'],
    )
    assert.throws(() => adapted('sign', {}, [cert]), /PKCS#12|PEM certificate/)
    assert.throws(
      () => adapted('sign', { certificatePassword: 'secret' }, [cert, key]),
      /only to PKCS#12/,
    )
    const pkcs12 = adapted('sign', { certificatePassword: 'secret' }, [
      new File(['certificate'], 'signer.p12'),
    ])
    assert.deepEqual(pkcs12.stages, [
      { op: 'sign', certificate: 'signer.p12', certificatePassword: 'secret' },
    ])
  })

  it.each([
    ['select-pages', { pages: '1;rm -rf /' }, /pages/],
    ['delete-pages', { pages: '' }, /pages/],
    ['render-pages', { format: 'png', quality: '50' }, /JPEG quality/],
    ['render-pages', { format: 'jpeg', dpi: '1000' }, /DPI/],
    ['timestamp', { timestampUrl: 'file:///etc/passwd' }, /HTTP\(S\)/],
    ['convert-colors', { target: 'invalid' }, /colour space/],
    ['detach', { attachmentName: '' }, /embedded filename/],
  ] as const)('rejects unsafe or invalid %s inputs', (id, fields, reason) => {
    assert.throws(() => adapted(id, fields), reason)
  })

  it('rejects legacy v8 extras and unused upload bytes', () => {
    const args = request('select-pages', { pages: '1' }, [], { quality: 0.5 })
    assert.throws(
      () => adaptPdfForm(args.operation, args.payload, args.legacy, 9, []),
      /legacy advanced/,
    )
    assert.throws(
      () => adapted('select-pages', { pages: '1' }, [new File(['a'], 'junk.txt')]),
      /does not accept additional files/,
    )
  })
})

describe('PDF compliance result reporting', () => {
  it('preserves per-file noncompliance and violation details', () => {
    const report = parsePdfValidationReport(
      JSON.stringify({
        'alpha.pdf': { profile: 'PDF/A-2b', compliant: true, violations: [] },
        'beta.pdf': {
          profile: ['PDF/A-3b', 'PDF/UA-1'],
          compliant: false,
          violations: [{ description: 'Missing accessibility tag', severity: 'fatal' }],
        },
      }),
    )
    assert.equal(report?.length, 2)
    assert.deepEqual(report?.[0], {
      filename: 'alpha.pdf',
      compliant: true,
      profile: 'PDF/A-2b',
      violations: [],
      totalViolations: 0,
    })
    assert.deepEqual(report?.[1]?.violations[0], {
      id: 'beta.pdf-0',
      description: 'Missing accessibility tag',
      severity: 'fatal',
    })
    assert.equal(report?.[1]?.compliant, false)
  })

  it.each([
    '',
    'not JSON',
    '{}',
    '[]',
    '{"file.pdf":null}',
    '{"file.pdf":{"compliant":"yes","violations":[]}}',
  ])('rejects malformed or empty compliance reports', (input) => {
    assert.equal(parsePdfValidationReport(input), null)
  })
})
