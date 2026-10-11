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
    expect(() => addRemoteAttachmentMetadata('', ' invoice.xml')).toThrow(/filename/)
    expect(() => addRemoteAttachmentMetadata('{', 'invoice.xml')).toThrow(/Fix/)
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
