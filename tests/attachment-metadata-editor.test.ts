import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test, vi } from 'vitest'
import { AttachmentMetadataEditor } from '#/components/attachment-metadata-editor'
import {
  addRemoteAttachmentMetadata,
  deleteAttachmentMetadata,
  parseAttachmentMetadata,
  setAttachmentMetadata,
} from '#/lib/attachment-metadata'
import { createGotenbergForm } from '#/lib/gotenberg-client'
import { validateFiles, validatePayload } from '#/lib/validation'

const invoice = new File(['<invoice />'], 'invoice.xml', { type: 'application/xml' })
const pdf = new File(['%PDF-1.7\n'], 'document.pdf', { type: 'application/pdf' })

function result(id: string, metadata: string, remote = false) {
  const { operation, payload } = validatePayload({
    operation: id,
    fields: id === 'embed' ? { embedsMetadata: metadata } : { url: 'https://example.test' },
    advanced: {},
    ...(id !== 'embed' ? { postProcess: { embedsMetadata: metadata } } : {}),
    ...(remote
      ? { downloadFrom: [{ url: 'https://assets.example.test/invoice.xml', field: 'embedded' }] }
      : {}),
  })
  assert.ok(operation)
  const files = id === 'embed' ? [pdf] : []
  const auxiliary = id === 'embed' && !remote ? [invoice] : []
  const postFiles = id === 'embed' || remote ? {} : { embeds: [invoice] }
  validateFiles(operation, files, auxiliary, 4_000_000, payload, postFiles)
  return createGotenbergForm(operation, payload, files, auxiliary, 4_000_000, postFiles)
}

describe('native PDF/A attachment metadata editor', () => {
  test('creates and updates supported metadata fields without dropping other attachments', () => {
    const initial = JSON.stringify({ 'original.txt': { relationship: 'Source' } })
    const withMime = setAttachmentMetadata(initial, 'invoice.xml', 'mimeType', 'application/xml')
    const withRelation = setAttachmentMetadata(
      withMime,
      'invoice.xml',
      'relationship',
      'Alternative',
    )
    expect(JSON.parse(withRelation)).toEqual({
      'original.txt': { relationship: 'Source' },
      'invoice.xml': { mimeType: 'application/xml', relationship: 'Alternative' },
    })
    expect(JSON.parse(setAttachmentMetadata(withRelation, 'invoice.xml', 'mimeType', ''))).toEqual({
      'original.txt': { relationship: 'Source' },
      'invoice.xml': { relationship: 'Alternative' },
    })
    expect(JSON.parse(deleteAttachmentMetadata(withRelation, 'original.txt'))).toEqual({
      'invoice.xml': { mimeType: 'application/xml', relationship: 'Alternative' },
    })
  })

  test('adds an exact remote filename with a safe default relationship', () => {
    const remote = addRemoteAttachmentMetadata('', 'invoice.xml')
    expect(JSON.parse(remote)).toEqual({ 'invoice.xml': { relationship: 'Unspecified' } })
    expect(() => addRemoteAttachmentMetadata(remote, 'INVOICE.XML')).toThrow(/already/)
    expect(() => addRemoteAttachmentMetadata('', '../secret.xml')).toThrow(/filename/)
    expect(() => addRemoteAttachmentMetadata('', 'folder/invoice.xml')).toThrow(/filename/)
    expect(JSON.parse(addRemoteAttachmentMetadata('', ' invoice.xml'))).toEqual({
      ' invoice.xml': { relationship: 'Unspecified' },
    })
    expect(() => addRemoteAttachmentMetadata('{', 'invoice.xml')).toThrow(/Fix/)
  })

  test('allows punctuation, Unicode, long filenames, and parameterised MIME types', () => {
    const name = `Résumé & invoices (Q4) - ${'x'.repeat(155)}.xml`
    const raw = setAttachmentMetadata('', name, 'mimeType', 'application/xml; charset=UTF-8')
    expect(JSON.parse(raw)).toEqual({
      [name]: { mimeType: 'application/xml; charset=UTF-8' },
    })
    expect(() => addRemoteAttachmentMetadata(raw, name.normalize('NFD'))).toThrow(/already/)
    expect(() => addRemoteAttachmentMetadata('', 'file\u0000.xml')).toThrow(/filename/)
    expect(() =>
      setAttachmentMetadata('', 'invoice.xml', 'mimeType', 'text/plain\r\nInjected: yes'),
    ).toThrow(/MIME/)
  })

  test('preserves special filename keys without mutating object prototypes', () => {
    const value = setAttachmentMetadata('', '__proto__', 'mimeType', 'text/plain')
    expect(JSON.parse(value)).toEqual({ ['__proto__']: { mimeType: 'text/plain' } })
    expect(Object.getPrototypeOf({})).toBe(Object.prototype)
    const updated = setAttachmentMetadata(value, '__proto__', 'relationship', 'Data')
    expect(JSON.parse(updated)).toEqual({
      ['__proto__']: { mimeType: 'text/plain', relationship: 'Data' },
    })
  })

  test('refuses invalid MIME, relationship, or malformed metadata JSON', () => {
    expect(() => setAttachmentMetadata('', 'invoice.xml', 'mimeType', 'text')).toThrow(/MIME/)
    expect(() => setAttachmentMetadata('', 'invoice.xml', 'relationship', 'Unknown')).toThrow(
      /relationship/,
    )
    for (const input of [
      '{',
      '[]',
      'null',
      '{"invoice.xml":[]}',
      '{"invoice.xml":{"notSupported":3}}',
    ]) {
      expect(parseAttachmentMetadata(input)).toBeNull()
    }
  })

  test.each(['url-pdf', 'embed'])(
    '%s sends official embedsMetadata and preserves attachments',
    (id) => {
      const json = setAttachmentMetadata(
        setAttachmentMetadata('', 'invoice.xml', 'mimeType', 'application/xml'),
        'invoice.xml',
        'relationship',
        'Alternative',
      )
      const body = result(id, json)
      expect(body.get('embedsMetadata')).toBe(json)
      expect((body.get('embeds') as File).name).toBe('invoice.xml')
      expect(body.has('relationship')).toBe(false)
      expect(body.has('mimeType')).toBe(false)
      expect(result(id, json, true).get('embedsMetadata')).toBe(json)
    },
  )

  test('rejects invalid metadata and files that cannot be matched', () => {
    for (const id of ['url-pdf', 'embed']) {
      expect(() => result(id, '{"invoice.xml":{"mimeType":"invalid"}}')).toThrow(
        /Invalid attachment metadata/,
      )
      expect(() => result(id, '{"missing.xml":{"relationship":"Data"}}')).toThrow(
        /file that was not uploaded/,
      )
      expect(() => result(id, '["not-an-object"]')).toThrow(/Attachment metadata/)
    }
  })

  test('accepts empty embedded attachments in standalone and conversion requests', () => {
    const empty = new File([], 'empty.txt', { type: 'text/plain' })
    const standalone = validatePayload({
      operation: 'embed',
      fields: { embedsMetadata: '{"empty.txt":{"relationship":"Data"}}' },
      advanced: {},
    })
    validateFiles(standalone.operation, [pdf], [empty], 4_000_000, standalone.payload)
    const embedForm = createGotenbergForm(standalone.operation, standalone.payload, [pdf], [empty])
    const embedFile = embedForm.get('embeds') as File
    assert.equal(embedFile.name, 'empty.txt')
    assert.equal(embedFile.size, 0)

    const conversion = validatePayload({
      operation: 'url-pdf',
      fields: { url: 'https://example.test' },
      advanced: {},
      postProcess: { embedsMetadata: '{"empty.txt":{"relationship":"Data"}}' },
    })
    const postFiles = { embeds: [empty] }
    validateFiles(conversion.operation, [], [], 4_000_000, conversion.payload, postFiles)
    const converted = createGotenbergForm(
      conversion.operation,
      conversion.payload,
      [],
      [],
      4_000_000,
      postFiles,
    )
    assert.equal((converted.get('embeds') as File).size, 0)
    assert.equal(converted.get('embedsMetadata'), '{"empty.txt":{"relationship":"Data"}}')

    const emptySource = new File([], 'source.pdf', { type: 'application/pdf' })
    expect(() =>
      validateFiles(standalone.operation, [emptySource], [empty], 4_000_000, standalone.payload),
    ).toThrow(/empty/)
    const invalidPostFiles = { embeds: [empty], facturxXml: new File([], 'invoice.xml') }
    expect(() =>
      validateFiles(conversion.operation, [], [], 4_000_000, conversion.payload, invalidPostFiles),
    ).toThrow(/empty/)
  })

  test('renders uploaded and remote attachment controls as native inputs', () => {
    const html = renderToStaticMarkup(
      createElement(AttachmentMetadataEditor, {
        files: [invoice],
        value: '{"remote.xml":{"relationship":"Supplement"}}',
        onChange: vi.fn(),
      }),
    )
    for (const label of [
      'invoice.xml',
      'remote.xml',
      'MIME type',
      'PDF/A relationship',
      'Remote attachment filename',
      'Custom attachment metadata JSON',
    ]) {
      expect(html).toContain(label)
    }
    for (const relationship of ['Source', 'Data', 'Alternative', 'Supplement', 'Unspecified']) {
      expect(html).toContain(relationship)
    }
    const bad = renderToStaticMarkup(
      createElement(AttachmentMetadataEditor, { files: [invoice], value: '[]', onChange: vi.fn() }),
    )
    expect(bad).toContain('role="alert"')
    expect(bad).toContain('disabled=""')
  })
})
