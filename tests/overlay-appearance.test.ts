import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test, vi } from 'vitest'
import { OverlayAppearanceEditor } from '#/components/overlay-appearance-editor'
import { OverlayGroupsEditor } from '#/components/pdf-conversion-post-processing'
import { createGotenbergForm } from '#/lib/gotenberg-client'
import {
  overlayAppearanceValue,
  overlayScaleMode,
  parseOverlayAppearance,
  removeTextOverlayAppearance,
  updateOverlayAppearance,
  updateOverlayScaleMode,
} from '#/lib/overlay-appearance'
import { validateFiles, validatePayload } from '#/lib/validation'

const apply = (
  raw: string | undefined,
  name: Parameters<typeof updateOverlayAppearance>[1],
  value: string,
) => updateOverlayAppearance(raw, name, value)

function withOverlay(operation: string, options: string) {
  const { operation: op, payload } = validatePayload({
    operation,
    fields: operation === 'url-pdf' ? { url: 'https://example.test' } : {},
    advanced: {},
    postProcess: {
      [operation === 'stamp' ? 'stamps' : 'watermarks']: [
        { source: 'text', expression: 'DRAFT', options },
      ],
    },
  })
  assert.ok(op)
  const files = operation === 'stamp' ? [new File(['%PDF-1.7\n'], 'one.pdf')] : []
  validateFiles(op, files, [], 4_000_000, payload, {})
  return createGotenbergForm(op, payload, files, [], 4_000_000, {})
}

describe('native PDF overlay appearance controls', () => {
  test('writes the documented pdfcpu style keys with typed ranges', () => {
    let options = ''
    for (const [key, value] of [
      ['opacity', '0.25'],
      ['rotation', '-45'],
      ['position', 'br'],
      ['scalefactor', '0.75'],
      ['offset', '12 -5.5'],
      ['points', '48'],
      ['fontname', 'Helvetica'],
      ['color', '#008000'],
    ] as const) {
      options = apply(options, key, value)
    }
    expect(JSON.parse(options)).toEqual({
      opacity: 0.25,
      rotation: -45,
      position: 'br',
      scalefactor: '1 abs',
      offset: '12 -5.5',
      points: 48,
      fontname: 'Helvetica',
      color: '#008000',
    })
    expect(overlayAppearanceValue(options, 'scalefactor')).toBe('1')
    expect(overlayScaleMode(options)).toBe('abs')
    expect(overlayAppearanceValue(options, 'opacity')).toBe('0.25')
    expect(overlayAppearanceValue(options, 'position')).toBe('br')
  })

  test('explicit text size switches to absolute scale and supports selecting the scaling mode', () => {
    const sized = apply('', 'points', '32')
    expect(JSON.parse(sized)).toEqual({ points: 32, scalefactor: '1 abs' })
    const absolute = updateOverlayScaleMode('{"scalefactor":"0.25 rel"}', 'abs')
    expect(overlayAppearanceValue(absolute, 'scalefactor')).toBe('0.25')
    expect(overlayScaleMode(absolute)).toBe('abs')
    expect(() => updateOverlayScaleMode(sized, 'rel')).toThrow(/Text size/)
    expect(overlayScaleMode(updateOverlayScaleMode(absolute, 'rel'))).toBe('rel')
  })

  test('leaves unknown engine settings unchanged and supports legacy style aliases', () => {
    const initial = '{"font":"Courier","scale":"0.5 rel","vendorOptions":{"a":1}}'
    expect(overlayAppearanceValue(initial, 'fontname')).toBe('Courier')
    expect(overlayAppearanceValue(initial, 'scalefactor')).toBe('0.5')
    const styled = apply(apply(initial, 'fontname', 'Times-Roman'), 'scalefactor', '0.8')
    expect(JSON.parse(styled)).toEqual({
      fontname: 'Times-Roman',
      scalefactor: '0.8 rel',
      vendorOptions: { a: 1 },
    })
    expect(JSON.parse(apply(styled, 'fontname', ''))).not.toHaveProperty('fontname')
    expect(apply('{"opacity":0.6}', 'opacity', '')).toBe('')
  })

  test('refuses invalid values without corrupting the custom JSON', () => {
    const invalid = [
      ['opacity', '-0.01'],
      ['opacity', '1.01'],
      ['opacity', 'oops'],
      ['rotation', '181'],
      ['points', '23.5'],
      ['points', '0'],
      ['scalefactor', '0'],
      ['scalefactor', '2'],
      ['offset', '1'],
      ['offset', '1; 2'],
      ['color', '#12345'],
      ['fontname', 'bad:name'],
      ['position', 'offscreen'],
    ] as const
    for (const [key, value] of invalid) {
      expect(() => apply('{"vendorKey":true}', key, value), `${key}=${value}`).toThrow()
    }
    for (const malformed of ['{', '[]', 'null', '23']) {
      expect(parseOverlayAppearance(malformed)).toBeNull()
      expect(() => apply(malformed, 'opacity', '0.2')).toThrow(/Fix the options JSON/)
    }
  })

  test('switching source preserves positioning but discards pdfcpu text-only parameters', () => {
    const input =
      '{"font":"Helvetica","points":48,"fillcolor":"#abcdef","position":"tr","opacity":0.3,"vendor":12}'
    expect(JSON.parse(removeTextOverlayAppearance(input) ?? '{}')).toEqual({
      position: 'tr',
      opacity: 0.3,
      vendor: 12,
    })
    expect(removeTextOverlayAppearance('{broken')).toBe('{broken')
  })

  test.each(['url-pdf', 'stamp'])(
    '%s forwards the generated options without new wire fields',
    (operation) => {
      const styled = apply(apply('{}', 'opacity', '0.4'), 'rotation', '30')
      const result = withOverlay(operation, styled)
      const kind = operation === 'stamp' ? 'stamp' : 'watermark'
      expect(result.get(`${kind}Options`)).toBe(styled)
      expect(result.getAll(`${kind}Source`)).toEqual(['text'])
      expect(result.has('opacity')).toBe(false)
      expect(result.has('appearance')).toBe(false)
    },
  )

  test('renders labelled appearance controls in both overlay editors', () => {
    const html = renderToStaticMarkup(
      createElement(OverlayAppearanceEditor, {
        source: 'text',
        options: '{"opacity":0.4}',
        onChange: vi.fn(),
      }),
    )
    for (const label of [
      'Opacity',
      'Rotation',
      'Scale factor',
      'Position',
      'Font name',
      'Text colour',
    ]) {
      expect(html).toContain(label)
    }
    expect(html).toContain('Custom PDF-engine options JSON')
    const image = renderToStaticMarkup(
      createElement(OverlayAppearanceEditor, { source: 'image', onChange: vi.fn() }),
    )
    expect(image).toContain('Opacity')
    expect(image).not.toContain('Text colour')
    const bad = renderToStaticMarkup(
      createElement(OverlayAppearanceEditor, { source: 'text', options: '{', onChange: vi.fn() }),
    )
    expect(bad).toContain('disabled=""')
    expect(bad).toContain('role="alert"')
    const group = renderToStaticMarkup(
      createElement(OverlayGroupsEditor, {
        kind: 'watermark',
        rows: [{ source: 'text', expression: 'DRAFT' }],
        files: [],
        onRowsChange: vi.fn(),
        onFilesChange: vi.fn(),
      }),
    )
    expect(group).toContain('Appearance settings')
  })
})
