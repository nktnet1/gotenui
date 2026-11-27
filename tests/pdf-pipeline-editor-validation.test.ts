import assert from 'node:assert/strict'
import { describe, it } from 'vitest'
import type { RemoteInputRow } from '#/lib/async-inputs'
import { pdfPipelineEditorError } from '#/lib/pdf-pipeline-editor-validation'

const assetStages = JSON.stringify([
  { op: 'stamp-image', image: 'brand.png' },
  { op: 'attach', file: 'invoice.xml' },
])

const remoteRow = (id: number, filename: string): RemoteInputRow => ({
  id,
  url: `https://documents.example.test/${id}`,
  filename,
  field: '',
  headers: [],
})

const base = {
  localAssetNames: [] as string[],
  archivesPresent: false,
  remoteRows: [] as RemoteInputRow[],
  remoteJson: '',
  acknowledgedRedaction: false,
}

describe('PDF pipeline editor remote asset preflight', () => {
  it('accepts named remote stage assets without local uploads for PDF processing', () => {
    assert.equal(
      pdfPipelineEditorError(assetStages, {
        ...base,
        remoteRows: [remoteRow(1, 'brand.png'), remoteRow(2, 'invoice.xml')],
      }),
      null,
    )
  })

  it('shares the same preflight with conversion-time PDF processing', () => {
    const conversionStages = JSON.stringify([
      { op: 'attach', file: 'invoice.xml' },
      { op: 'remediate', profile: 'PDF/A-3b' },
    ])
    assert.equal(
      pdfPipelineEditorError(conversionStages, {
        ...base,
        remoteRows: [remoteRow(3, 'invoice.xml')],
      }),
      null,
    )
  })

  it('accepts remote filename hints from advanced JSON and combines them with local files', () => {
    assert.equal(
      pdfPipelineEditorError(assetStages, {
        ...base,
        localAssetNames: ['brand.png'],
        remoteJson: JSON.stringify([
          { url: 'https://documents.example.test/invoice', name: 'invoice.xml' },
        ]),
      }),
      null,
    )
  })

  it('does not mistake legacy remote destinations for named assets', () => {
    const missing = pdfPipelineEditorError(assetStages, {
      ...base,
      localAssetNames: ['brand.png'],
      remoteJson: JSON.stringify([
        { url: 'https://documents.example.test/invoice', name: 'invoice.xml', field: 'embedded' },
      ]),
    })
    assert.match(missing ?? '', /invoice\.xml/)
  })

  it('still rejects missing assets, invalid stages, and unacknowledged redaction', () => {
    assert.match(pdfPipelineEditorError(assetStages, base) ?? '', /brand\.png/)
    assert.match(
      pdfPipelineEditorError(assetStages, {
        ...base,
        remoteRows: [remoteRow(1, 'brand.png')],
      }) ?? '',
      /invoice\.xml/,
    )
    assert.match(
      pdfPipelineEditorError('[{"op":"rotate","angle":45}]', base) ?? '',
      /multiple of 90/,
    )
    assert.match(
      pdfPipelineEditorError(
        '[{"op":"redact","regions":[{"page":1,"x":0,"y":0,"width":4,"height":4}]}]',
        base,
      ) ?? '',
      /Confirm that redaction/,
    )
  })

  it('defers filename matching to Gotenberg when stage assets may be inside ZIPs', () => {
    assert.equal(pdfPipelineEditorError(assetStages, { ...base, archivesPresent: true }), null)
    assert.match(
      pdfPipelineEditorError('[{"op":"unknown"}]', { ...base, archivesPresent: true }) ?? '',
      /supported PDF operation/,
    )
  })

  it('gives a useful error for invalid remote JSON rather than silently ignoring hints', () => {
    assert.match(
      pdfPipelineEditorError(assetStages, { ...base, remoteJson: '{' }) ?? '',
      /Remote files must be valid JSON/,
    )
  })
})

it('rejects local stage files left behind when a stage is removed, even with archives', () => {
  for (const documentKind of ['pdf', 'office', 'single'] as const) {
    for (const archivesPresent of [false, true]) {
      assert.match(
        pdfPipelineEditorError('[{"op":"merge"}]', {
          ...base,
          documentKind,
          archivesPresent,
          localAssetNames: ['removed-insert.pdf'],
        }) ?? '',
        /Unused .*stage file: removed-insert\.pdf/,
      )
    }
  }
  assert.match(
    pdfPipelineEditorError('', {
      ...base,
      documentKind: 'office',
      localAssetNames: ['removed-insert.pdf'],
    }) ?? '',
    /Unused .*stage file: removed-insert\.pdf/,
  )
  assert.equal(
    pdfPipelineEditorError('[{"op":"attach","file":"caf\u00e9.pdf"}]', {
      ...base,
      documentKind: 'pdf',
      localAssetNames: ['cafe\u0301.pdf'],
    }),
    null,
  )
})

it('rejects raw decryption stages in conversion-time editors only', () => {
  const stages = '[{"op":"decrypt","password":"secret"}]'
  for (const documentKind of ['office', 'single'] as const) {
    assert.match(
      pdfPipelineEditorError(stages, { ...base, documentKind }) ?? '',
      /Decryption is only available for uploaded PDFs/,
    )
  }
  assert.equal(pdfPipelineEditorError(stages, { ...base, documentKind: 'pdf' }), null)
})

it('requires deterministic remote filenames when local stage assets could be shadowed', () => {
  assert.match(
    pdfPipelineEditorError('[{"op":"attach","file":"proof.txt"}]', {
      ...base,
      backendVersion: '9.10.0',
      documentKind: 'pdf',
      documentNames: ['source.pdf'],
      localAssetNames: ['proof.txt'],
      remoteRows: [remoteRow(1, '')],
    }) ?? '',
    /Specify a remote filename/,
  )
})

it('requires v9.2 to pin downloads alongside Chromium conversion pipelines', () => {
  assert.match(
    pdfPipelineEditorError('[{"op":"optimize"}]', {
      ...base,
      backendVersion: '9.1.0',
      documentKind: 'single',
      remoteJson: '[{"url":"https://example.test/style.css"}]',
    }) ?? '',
    /Chromium remote downloads alongside local assets require Gotenberg 9.2/,
  )
})

it('retains dynamically named downloads where no local or remote asset needs protection', () => {
  assert.equal(
    pdfPipelineEditorError('[{"op":"optimize"}]', {
      ...base,
      backendVersion: '9.10.0',
      documentKind: 'pdf',
      remoteRows: [remoteRow(1, '')],
    }),
    null,
  )
})

it.each(['pdf', 'office', 'single'] as const)(
  'rejects a named remote stage asset displaced by earlier duplicate %s downloads',
  (documentKind) => {
    const filename = documentKind === 'office' ? 'document.docx' : 'document.pdf'
    const asset = filename.replace('.', ' (2).')
    const url = `https://documents.example.test/${filename}`
    for (const archivesPresent of [false, true]) {
      assert.match(
        pdfPipelineEditorError(JSON.stringify([{ op: 'attach', file: asset }]), {
          ...base,
          documentKind,
          backendVersion: '9.10.0',
          archivesPresent,
          remoteJson: JSON.stringify([{ url }, { url }, { url, filename: asset }]),
        }) ?? '',
        /Stage asset filename collides after Gotenberg numbers duplicate files/,
      )
    }
  },
)

it('allows duplicate source downloads when they do not displace a named stage asset', () => {
  const url = 'https://documents.example.test/document.pdf'
  assert.equal(
    pdfPipelineEditorError('[{"op":"attach","file":"document (2).pdf"}]', {
      ...base,
      documentKind: 'pdf',
      backendVersion: '9.10.0',
      remoteJson: JSON.stringify([{ url, filename: 'document (2).pdf' }, { url }, { url }]),
    }),
    null,
  )
})

it('rejects a numbered remote resource that shadows an explicitly named Chromium upload', () => {
  const url = 'https://documents.example.test/style.css'
  const options = {
    ...base,
    documentKind: 'single' as const,
    backendVersion: '9.10.0',
    remoteJson: JSON.stringify([{ url }, { url }]),
  }
  assert.match(
    pdfPipelineEditorError('[{"op":"optimize"}]', {
      ...options,
      chromiumResourceNames: ['index.html', 'style (2).css'],
    }) ?? '',
    /Chromium asset filename collides after Gotenberg numbers duplicate files: style \(2\)\.css/,
  )
  assert.equal(
    pdfPipelineEditorError('[{"op":"optimize"}]', {
      ...options,
      chromiumResourceNames: ['index.html', 'other.css'],
    }),
    null,
  )
})

it('uses numbered merge upload names rather than rejecting safe duplicate source uploads', () => {
  const options = {
    ...base,
    documentKind: 'pdf' as const,
    backendVersion: '9.10.0',
    localAssetNames: ['document (2).pdf'],
    documentNames: ['document.pdf', 'document.pdf'],
  }
  assert.match(
    pdfPipelineEditorError('[{"op":"attach","file":"document (2).pdf"}]', options) ?? '',
    /Stage asset filename collides after Gotenberg numbers duplicate files/,
  )
  assert.equal(
    pdfPipelineEditorError('[{"op":"merge"},{"op":"attach","file":"document (2).pdf"}]', options),
    null,
  )
})

it.each(['pdf', 'office'] as const)(
  'rejects known %s source collisions even with archives',
  (documentKind) => {
    const filename = documentKind === 'office' ? 'document.docx' : 'document.pdf'
    assert.match(
      pdfPipelineEditorError(JSON.stringify([{ op: 'attach', file: filename }]), {
        ...base,
        documentKind,
        backendVersion: '9.10.0',
        archivesPresent: true,
        documentNames: [filename],
      }) ?? '',
      /source|primary/i,
    )
  },
)

it('checks known Chromium resources alongside uninspected archives', () => {
  const url = 'https://documents.example.test/style.css'
  assert.match(
    pdfPipelineEditorError('', {
      ...base,
      documentKind: 'single',
      backendVersion: '9.10.0',
      archivesPresent: true,
      remoteJson: JSON.stringify([{ url }, { url }]),
      chromiumResourceNames: ['style (2).css'],
    }) ?? '',
    /Chromium asset filename collides/,
  )
})

it('rejects same-name remote and generated Chromium resources without PDF stages', () => {
  const options = {
    ...base,
    documentKind: 'single' as const,
    backendVersion: '9.10.0',
    chromiumResourceNames: ['index.html'],
    remoteJson: '[{"url":"https://example.test/index.html"}]',
  }
  for (const archivesPresent of [false, true]) {
    assert.match(
      pdfPipelineEditorError('', { ...options, archivesPresent }) ?? '',
      /Remote filename collides with a local document or asset: index\.html/,
    )
  }
})

it.each(['9.1.0', '9.10.0'])(
  'preserves dynamic remote-only Chromium filenames on %s',
  (backendVersion) => {
    const options = {
      ...base,
      documentKind: 'single' as const,
      backendVersion,
      remoteRows: [remoteRow(1, '')],
    }
    assert.equal(pdfPipelineEditorError('', options), null)
    assert.match(
      pdfPipelineEditorError('', { ...options, chromiumResourceNames: ['index.html'] }) ?? '',
      /filename/i,
    )
  },
)

it('protects explicit remote-only Chromium resources from earlier unpredictable downloads', () => {
  const options = {
    ...base,
    documentKind: 'single' as const,
    backendVersion: '9.10.0',
    remoteRows: [remoteRow(1, ''), remoteRow(2, 'style.css')],
  }
  assert.match(pdfPipelineEditorError('', options) ?? '', /Specify a remote filename/)
  assert.equal(
    pdfPipelineEditorError('', { ...options, remoteRows: [...options.remoteRows].reverse() }),
    null,
  )
})

it('rejects known local stage assets displaced by duplicate sources even with archives', () => {
  assert.match(
    pdfPipelineEditorError('[{"op":"attach","file":"document (2).pdf"}]', {
      ...base,
      documentKind: 'pdf',
      backendVersion: '9.10.0',
      archivesPresent: true,
      documentNames: ['document.pdf', 'document.pdf'],
      localAssetNames: ['document (2).pdf'],
    }) ?? '',
    /Stage asset filename collides/,
  )
})

it('preflights built-in conversion stages even when the user pipeline is empty', () => {
  const draft = {
    ...base,
    backendVersion: '9.10.2',
    documentKind: 'office' as const,
    documentNames: ['one.docx', 'two.docx'],
  }
  assert.match(
    pdfPipelineEditorError('', {
      ...draft,
      builtInMerge: true,
      conversionFields: { merge: true, pdfaProfile: 'PDF/A-2b', pdfaMethod: 'native' },
    }) ?? '',
    /requires PDF remediation/,
  )
  assert.equal(
    pdfPipelineEditorError('', {
      ...draft,
      builtInMerge: true,
      conversionFields: { merge: true, pdfaProfile: 'PDF/A-2b', pdfaMethod: 'auto' },
    }),
    null,
  )
  assert.match(
    pdfPipelineEditorError('', {
      ...draft,
      backendVersion: '9.1.0',
      conversionFields: { splitMode: 'pages', splitSpan: '1-' },
    }) ?? '',
    /9.2 or newer/,
  )
  assert.equal(
    pdfPipelineEditorError('', {
      ...draft,
      conversionFields: { splitMode: 'pages', splitSpan: '1-' },
    }),
    null,
  )
})

it.each(['[]', 'null', '   '])(
  'does not impose the v9.2 filename requirement for an empty pipeline %j',
  (stages) => {
    assert.equal(
      pdfPipelineEditorError(stages, {
        ...base,
        backendVersion: '9.1.0',
        documentKind: 'single',
        remoteJson: '[{"url":"https://example.test/download"}]',
      }),
      null,
    )
  },
)
