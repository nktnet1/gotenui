import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, it } from 'vitest'
import { PdfConversionPostProcessing } from '#/components/pdf-conversion-post-processing'
import { PdfBookmarksEditor } from '#/components/pdf-structure-editors'
import { createGotenbergForm } from '#/lib/gotenberg-client'
import { isFieldVisible, OPERATION_BY_ID, operationDefaults } from '#/lib/operations'
import { importReadableBookmarks, importReadableMetadata } from '#/lib/pdf-read-import'
import {
  addBookmarkMapping,
  editFileBookmarks,
  removeBookmarkMapping,
  validateBookmarkDocument,
  visualBookmarkMap,
} from '#/lib/pdf-structure-editors'
import { validatePayload } from '#/lib/validation'

function validated(id: string, fields: Record<string, string | boolean>) {
  const operation = OPERATION_BY_ID.get(id)
  assert.ok(operation)
  return validatePayload({
    operation: id,
    fields: {
      ...operationDefaults(operation),
      ...fields,
      ...(operation.input === 'url' ? { url: 'https://example.test' } : {}),
    },
    advanced: {},
    ...(operation.input === 'html' ? { source: '<html><body>Hello</body></html>' } : {}),
    ...(operation.input === 'markdown' ? { source: '# Hello' } : {}),
  })
}

function form(id: string, fields: Record<string, string | boolean>, files: File[] = []) {
  const { operation, payload } = validated(id, fields)
  return createGotenbergForm(operation, payload, files, [])
}

const pdf = (name: string) => new File(['%PDF-1.7\n'], name, { type: 'application/pdf' })
const office = new File(['office'], 'slides.pptx', {
  type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
})

describe('v1.0.6 official native fields', () => {
  it('exposes the screenshot encoding switch on exactly the three screenshot operations', () => {
    for (const id of ['url-shot', 'html-shot', 'markdown-shot']) {
      const definition = OPERATION_BY_ID.get(id)
      assert.ok(
        definition?.fields.some(
          (field) => field.name === 'optimizeForSpeed' && field.kind === 'toggle',
        ),
      )
      assert.equal(form(id, { optimizeForSpeed: true }).get('optimizeForSpeed'), 'true')
    }
    assert.throws(() => validated('url-pdf', { optimizeForSpeed: true }), /Unsupported field/)
  })

  it('serializes all six standalone PDF permissions with upstream names', () => {
    const settings = {
      userPassword: 'test-owner',
      allowPrinting: false,
      allowCopying: false,
      allowModifying: false,
      allowAnnotating: false,
      allowFillingForms: false,
      allowAssembling: false,
    }
    const encoded = form('encrypt', settings, [pdf('one.pdf')])
    for (const name of Object.keys(settings).filter((name) => name.startsWith('allow'))) {
      assert.equal(encoded.get(name), 'false', name)
    }
    assert.equal(encoded.get('userPassword'), 'test-owner')
  })

  it('exposes all previously missing LibreOffice export and viewer controls', () => {
    const settings = {
      exportNotesInMargin: true,
      allowDuplicateFieldNames: true,
      addOriginalDocumentAsStream: true,
      convertOooTargetToPdfTarget: true,
      exportLinksRelativeFsys: true,
      resizeWindowToInitialPage: true,
      hideViewerWindowControls: true,
      useTransitionEffects: false,
      openBookmarkLevels: '-1',
    }
    const encoded = form('office-pdf', settings, [office])
    for (const [name, value] of Object.entries(settings))
      assert.equal(encoded.get(name), String(value), name)
    assert.throws(
      () => validated('office-pdf', { allowDuplicateFieldNames: true, exportFormFields: false }),
      /requires|related option/,
    )
    assert.throws(() => validated('office-pdf', { openBookmarkLevels: '-2' }), /permitted range/)
    assert.throws(
      () => validated('url-pdf', { addOriginalDocumentAsStream: true }),
      /Unsupported field/,
    )
  })

  it('accepts native LibreOffice watermark appearance and encodes RGB and tenths of degrees', () => {
    const settings = {
      nativeWatermarkText: 'CONFIDENTIAL',
      nativeTiledWatermarkText: 'REVIEW',
      nativeWatermarkColor: '#0e134b',
      nativeWatermarkFontName: 'Helvetica',
      nativeWatermarkFontHeight: '48',
      nativeWatermarkRotateAngle: '-22.5',
    }
    const encoded = form('office-pdf', settings, [office])
    assert.equal(encoded.get('nativeWatermarkText'), 'CONFIDENTIAL')
    assert.equal(encoded.get('nativeTiledWatermarkText'), 'REVIEW')
    assert.equal(encoded.get('nativeWatermarkColor'), String(0x0e134b))
    assert.equal(encoded.get('nativeWatermarkFontName'), 'Helvetica')
    assert.equal(encoded.get('nativeWatermarkFontHeight'), '48')
    assert.equal(encoded.get('nativeWatermarkRotateAngle'), '-225')
    const definition = OPERATION_BY_ID.get('office-pdf')
    const colour = definition?.fields.find((field) => field.name === 'nativeWatermarkColor')
    assert.ok(colour)
    assert.equal(isFieldVisible(colour, {}), false)
    assert.equal(isFieldVisible(colour, { nativeTiledWatermarkText: 'DRAFT' }), true)
    for (const bad of ['#ffffff00', '123456', 'red']) {
      assert.throws(
        () => validated('office-pdf', { nativeWatermarkText: 'DRAFT', nativeWatermarkColor: bad }),
        /colour/,
      )
    }
    assert.throws(
      () =>
        validated('office-pdf', {
          nativeWatermarkText: 'DRAFT',
          nativeWatermarkRotateAngle: '12.34',
        }),
      /one decimal/,
    )
    assert.throws(
      () => validated('office-pdf', { nativeWatermarkText: 'bad\nnewline' }),
      /single line/,
    )
    assert.throws(
      () => validated('office-pdf', { nativeWatermarkColor: '#ffffff' }),
      /related option/,
    )
  })

  it('exposes PDF metadata editors for standalone writes and merging, and uses conversion post-processing for Chromium and Office', () => {
    const metadata = '{"Title":"Quarterly report","Keywords":["work"]}'
    for (const id of ['metadata-write', 'merge']) {
      const definition = OPERATION_BY_ID.get(id)
      assert.ok(definition?.fields.some((field) => field.name === 'metadata'))
      const encoded = form(
        id,
        { metadata },
        id === 'merge' ? [pdf('a.pdf'), pdf('b.pdf')] : [pdf('a.pdf')],
      )
      assert.equal(encoded.get('metadata'), metadata)
      assert.throws(() => validated(id, { metadata: '[]' }), /Metadata must be a JSON object/)
    }
    for (const id of ['url-pdf', 'html-pdf', 'markdown-pdf', 'office-pdf']) {
      assert.equal(
        OPERATION_BY_ID.get(id)?.fields.some((field) => field.name === 'metadata'),
        false,
      )
    }
    const converted = validatePayload({
      operation: 'url-pdf',
      fields: { url: 'https://example.test' },
      advanced: {},
      postProcess: { metadata },
    })
    const convertedForm = createGotenbergForm(converted.operation, converted.payload, [], [])
    assert.deepEqual(convertedForm.getAll('metadata'), [metadata])
    const html = renderToStaticMarkup(
      createElement(PdfConversionPostProcessing, {
        value: {},
        onChange: () => {},
        files: {},
        onFilesChange: () => {},
      }),
    )
    assert.ok(html.includes('PDF metadata'))
    assert.ok(html.includes('Keywords'))
    assert.ok(html.includes('JSON editor'))
    assert.ok(!html.includes('PDF metadata JSON (optional)'))
  })

  it('adds visually editable per-input merge bookmark trees and preserves relative page numbers', () => {
    const combined = addBookmarkMapping('[]', 'a.pdf')
    const both = addBookmarkMapping(combined, 'b.pdf')
    const edited = editFileBookmarks(both, 'b.pdf', { kind: 'add', parent: [] })
    const titled = editFileBookmarks(edited, 'b.pdf', {
      kind: 'update',
      path: [0],
      field: 'title',
      value: 'Appendix',
    })
    const numbered = editFileBookmarks(titled, 'b.pdf', {
      kind: 'update',
      path: [0],
      field: 'page',
      value: '3',
    })
    assert.equal(visualBookmarkMap(numbered)?.['b.pdf']?.[0]?.page, 3)
    assert.equal(visualBookmarkMap(numbered)?.['b.pdf']?.[0]?.title, 'Appendix')
    validateBookmarkDocument(numbered)
    const encoded = form('merge', { bookmarks: numbered, autoIndexBookmarks: true }, [
      pdf('a.pdf'),
      pdf('b.pdf'),
    ])
    assert.deepEqual(JSON.parse(String(encoded.get('bookmarks'))), {
      '01_a.pdf': [],
      '02_b.pdf': [{ title: 'Appendix', page: 3, children: [] }],
    })
    assert.deepEqual(JSON.parse(removeBookmarkMapping(numbered, 'a.pdf')), {
      'b.pdf': [{ title: 'Appendix', page: 3, children: [] }],
    })
    assert.throws(() => addBookmarkMapping(numbered, '../evil.pdf'), /PDF filename/)
    assert.throws(
      () => addBookmarkMapping('[{"title":"Top","page":1}]', 'a.pdf'),
      /Remove shared bookmarks/,
    )
    assert.throws(() => validated('merge', { bookmarks: '{' }), /valid JSON/)
    const html = renderToStaticMarkup(
      createElement(PdfBookmarksEditor, {
        value: numbered,
        onChange: () => {},
        allowFilenameMap: true,
        filenames: ['a.pdf', 'b.pdf'],
      }),
    )
    assert.ok(html.includes('Bookmarks for PDF'))
    assert.ok(html.includes('Add filename mapping'))
    assert.ok(html.includes('Appendix') || html.includes('Add top-level bookmark'))
  })
})

describe('read existing PDF structure into visual writers', () => {
  it('imports editable metadata only, excluding ExifTool read-only tags', () => {
    const output = importReadableMetadata(
      {
        'report.pdf': {
          Title: 'Existing title',
          Author: 'Author',
          Keywords: ['one', 'two'],
          PageCount: 99,
          FileSize: '1 MB',
          Producer: 123,
          FileType: 'PDF',
        },
      },
      'report.pdf',
    )
    assert.deepEqual(JSON.parse(output), {
      Title: 'Existing title',
      Author: 'Author',
      Keywords: ['one', 'two'],
    })
    assert.throws(() => importReadableMetadata([], 'report.pdf'), /did not return metadata/)
    assert.throws(
      () => importReadableMetadata({ 'other.pdf': {} }, 'report.pdf'),
      /did not return metadata/,
    )
  })

  it('imports one bookmark tree as a list, multiple as a filename-keyed map', () => {
    const first = [{ title: 'Intro', page: 1, children: [] }]
    const second = [{ title: 'Appendix', page: 2, children: [] }]
    const response = { 'a.pdf': first, 'b.pdf': second }
    assert.deepEqual(JSON.parse(importReadableBookmarks(response, ['a.pdf'])), first)
    assert.deepEqual(JSON.parse(importReadableBookmarks(response, ['a.pdf', 'b.pdf'])), response)
    assert.throws(
      () => importReadableBookmarks(response, ['missing.pdf']),
      /did not return bookmarks/,
    )
    assert.throws(
      () => importReadableBookmarks({ 'a.pdf': [{ title: 'Bad', page: -1 }] }, ['a.pdf']),
      /page/,
    )
  })
})
