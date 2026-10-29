import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { PdfBookmarksEditor, PdfMetadataEditor } from '#/components/pdf-structure-editors'
import { createGotenbergForm } from '#/lib/gotenberg-client'
import {
  editBookmarks,
  metadataObject,
  updateMetadata,
  validateBookmarkDocument,
  visualBookmarkList,
  visualMetadataValue,
} from '#/lib/pdf-structure-editors'
import { validatePayload } from '#/lib/validation'

function request(id: string, fields: Record<string, string>) {
  return { operation: id, fields, advanced: {} }
}

const pdf = new File(['%PDF-1.7\n'], 'document.pdf', { type: 'application/pdf' })

function submittedField(id: string, key: string, json: string): string | null {
  const verified = validatePayload(request(id, { [key]: json }))
  const form = createGotenbergForm(verified.operation, verified.payload, [pdf], [])
  return form.get(key)?.toString() ?? null
}

describe('visual metadata fields', () => {
  it('keeps advanced XMP keys and non-text values when editing common fields', () => {
    const initial = '{"Title":"Old","CustomTag":true,"XMP:List":[1,2],"Keywords":["one","two"]}'
    const changed = updateMetadata(initial, 'Title', 'A better title')
    expect(JSON.parse(changed)).toEqual({
      Title: 'A better title',
      CustomTag: true,
      'XMP:List': [1, 2],
      Keywords: ['one', 'two'],
    })
    expect(visualMetadataValue(metadataObject(changed), 'Keywords')).toBe('one, two')
    expect(JSON.parse(updateMetadata(changed, 'Keywords', 'alpha, beta, , gamma'))).toEqual({
      Title: 'A better title',
      CustomTag: true,
      'XMP:List': [1, 2],
      Keywords: ['alpha', 'beta', 'gamma'],
    })
    expect(JSON.parse(updateMetadata(changed, 'Title', '   '))).not.toHaveProperty('Title')
  })

  it('does not silently coerce incompatible values or malformed JSON', () => {
    expect(visualMetadataValue({ Author: ['one'] }, 'Author')).toBeNull()
    expect(visualMetadataValue({ Keywords: [1, 2] }, 'Keywords')).toBeNull()
    expect(visualMetadataValue({}, 'Author')).toBe('')
    for (const raw of ['{', '[]', 'null', '42', '"a"']) {
      expect(() => metadataObject(raw)).toThrow(/Metadata/)
      expect(() => submittedField('metadata-write', 'metadata', raw)).toThrow()
    }
  })

  it('submits metadata through the existing Gotenberg multipart field', () => {
    const raw = updateMetadata('{"XMP:Extra":5}', 'Author', 'Gotenui')
    expect(submittedField('metadata-write', 'metadata', raw)).toBe(raw)
  })

  it('blocks ExifTool option aliases and filesystem side effects on old Gotenberg instances', () => {
    for (const key of [
      'j',
      'J',
      'json',
      'CSV',
      'addTagsFromFile',
      'allTagsFromFile',
      'XMP:HardLink',
      'System:FileName',
      '-config',
    ]) {
      const raw = JSON.stringify({ [key]: '/etc/passwd' })
      expect(() => metadataObject(raw)).toThrow(/Metadata key/)
      expect(() => submittedField('metadata-write', 'metadata', raw)).toThrow(/Metadata key/)
      expect(() =>
        validatePayload({
          operation: 'url-pdf',
          fields: { url: 'https://example.test' },
          advanced: {},
          postProcess: { metadata: raw },
        }),
      ).toThrow(/Metadata key/)
    }

    const grouped = '{"XMP:j":"legitimate","XMP-dc:json":"tag"}'
    expect(metadataObject(grouped)).toEqual({ 'XMP:j': 'legitimate', 'XMP-dc:json': 'tag' })
    expect(() =>
      validatePayload({
        operation: 'url-pdf',
        fields: { url: 'https://example.test' },
        advanced: { metadata: '{"j":"file"}' },
      }),
    ).toThrow(/Metadata key/)
  })

  it('renders common fields with a separate JSON mode and accessible control labels', () => {
    const html = renderToStaticMarkup(
      createElement(PdfMetadataEditor, { value: '{"Author":"Author"}', onChange: vi.fn() }),
    )
    for (const label of [
      'Title',
      'Author',
      'Subject',
      'Creator',
      'Producer',
      'Copyright',
      'Keywords',
    ]) {
      expect(html).toContain(`>${label}</label>`)
    }
    expect(html).toContain('Visual editor')
    expect(html).toContain('JSON editor')
    expect(html).toContain('aria-pressed="true"')
    expect(html).not.toContain('Metadata JSON</label>')
  })
})

describe('bookmark tree editing and route contract', () => {
  const original = JSON.stringify([
    { title: 'Opening', page: 1, children: [{ title: 'Subsection', page: 3, children: [] }] },
    { title: 'Appendix', page: 10, children: [] },
  ])

  it('supports add, title/page edits, sibling reordering and nested deletion', () => {
    let value = editBookmarks(original, { kind: 'add', parent: [0] })
    expect(visualBookmarkList(value)?.[0]?.children).toHaveLength(2)
    value = editBookmarks(value, {
      kind: 'update',
      path: [0, 1],
      field: 'title',
      value: 'New child',
    })
    value = editBookmarks(value, { kind: 'update', path: [0, 1], field: 'page', value: '12' })
    value = editBookmarks(value, { kind: 'move', path: [0, 1], direction: -1 })
    expect(visualBookmarkList(value)?.[0]?.children[0]).toMatchObject({
      title: 'New child',
      page: 12,
    })
    value = editBookmarks(value, { kind: 'remove', path: [0, 1] })
    expect(visualBookmarkList(value)?.[0]?.children).toHaveLength(1)
    expect(visualBookmarkList(value)?.[1]).toMatchObject({ title: 'Appendix', page: 10 })
    value = editBookmarks(value, { kind: 'add', parent: [] })
    expect(visualBookmarkList(value)).toHaveLength(3)
    assert.doesNotThrow(() => validateBookmarkDocument(value))
  })

  it('keeps draft blank pages invalid until corrected, with no silent default', () => {
    const blank = editBookmarks(original, {
      kind: 'update',
      path: [0],
      field: 'page',
      value: '',
    })
    expect(visualBookmarkList(blank)?.[0]?.page).toBe('')
    expect(() => validateBookmarkDocument(blank)).toThrow(/positive whole-number page/)
    expect(() => submittedField('bookmarks-write', 'bookmarks', blank)).toThrow(/page/)
    const fixed = editBookmarks(blank, {
      kind: 'update',
      path: [0],
      field: 'page',
      value: '9',
    })
    assert.doesNotThrow(() => validateBookmarkDocument(fixed))
  })

  it('validates every nested bookmark page, title and children shape', () => {
    for (const invalid of [
      [{ title: 'Bad', page: 0 }],
      [{ title: 'Bad', page: 1.5 }],
      [{ title: 'Bad', page: -1 }],
      [{ title: 'Bad', page: '1' }],
      [{ title: 'Bad', page: 1, children: [{ title: '', page: 2 }] }],
      [{ title: 'Bad', page: 1, children: {} }],
      [{ title: 'Bad' }],
      { 'document.pdf': [{ title: 'Bad', page: 0 }] },
      { 'nested/directory.pdf': [{ title: 'Good', page: 1 }] },
    ]) {
      const raw = JSON.stringify(invalid)
      expect(() => validateBookmarkDocument(raw), raw).toThrow()
      expect(() => submittedField('bookmarks-write', 'bookmarks', raw), raw).toThrow()
    }
  })

  it('preserves the documented shared-list and per-file-map forms', () => {
    const mapping = JSON.stringify({
      'document.pdf': [{ title: 'Intro', page: 1, children: [] }],
      'other.pdf': [{ title: 'End', page: 3, children: [] }],
    })
    assert.doesNotThrow(() => validateBookmarkDocument(mapping))
    expect(submittedField('bookmarks-write', 'bookmarks', mapping)).toBe(mapping)
    expect(submittedField('bookmarks-write', 'bookmarks', original)).toBe(original)
    expect(visualBookmarkList(mapping)).toBeNull()
    expect(() => editBookmarks(mapping, { kind: 'add', parent: [] })).toThrow(/JSON/)
  })

  it('does not discard unknown bookmark properties when editing a shared list', () => {
    const originalWithExtra = '[{"title":"A","page":1,"children":[],"futureField":"keep"}]'
    const updated = editBookmarks(originalWithExtra, {
      kind: 'update',
      path: [0],
      field: 'title',
      value: 'B',
    })
    expect(JSON.parse(updated)).toEqual([
      { title: 'B', page: 1, children: [], futureField: 'keep' },
    ])
    expect(editBookmarks(updated, { kind: 'move', path: [0], direction: 1 })).toBe(updated)
    expect(() => editBookmarks(updated, { kind: 'remove', path: [1] })).toThrow(/path/)
  })

  it('bounds nesting and total entries for malicious JSON payloads', () => {
    let tooDeep: unknown = [{ title: 'Deep', page: 1, children: [] }]
    for (let i = 0; i < 17; i++) tooDeep = [{ title: 'Deep', page: 1, children: tooDeep }]
    expect(() => validateBookmarkDocument(JSON.stringify(tooDeep))).toThrow(/nesting/)
    expect(() =>
      validateBookmarkDocument(
        JSON.stringify(Array.from({ length: 301 }, () => ({ title: 'X', page: 1 }))),
      ),
    ).toThrow(/300/)
  })

  it('renders a nested, accessible tree with a raw JSON fallback', () => {
    const html = renderToStaticMarkup(
      createElement(PdfBookmarksEditor, { value: original, onChange: vi.fn() }),
    )
    expect(html).toContain('Bookmark 1 title')
    expect(html).toContain('Bookmark 1.1 title')
    expect(html).toContain('Move Bookmark 1 down')
    expect(html).toContain('Add child')
    expect(html).toContain('Add top-level bookmark')
    expect(html).toContain('JSON editor')
    const mapped = renderToStaticMarkup(
      createElement(PdfBookmarksEditor, {
        value: '{"document.pdf":[]}',
        onChange: vi.fn(),
      }),
    )
    expect(mapped).toContain('Switch to JSON mode')
    expect(mapped).not.toContain('Add top-level bookmark')
  })
})
