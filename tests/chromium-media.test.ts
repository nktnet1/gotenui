import assert from 'node:assert/strict'
import { describe, expect, it } from 'vitest'
import { encodeChromiumMediaFeatures } from '#/lib/chromium-media'
import { createGotenbergForm } from '#/lib/gotenberg-client'
import { OPERATION_BY_ID, type Operation } from '#/lib/operations'
import { validatePayload } from '#/lib/validation'

function operation(id: string): Operation {
  const result = OPERATION_BY_ID.get(id)
  assert.ok(result)
  return result
}

function payload(id: string, fields: Record<string, string | boolean>, advanced = {}) {
  return validatePayload({
    operation: id,
    fields,
    advanced,
    ...(id.includes('html') ? { source: '<h1>Hello</h1>' } : {}),
  })
}

describe('first-class Chromium media emulation', () => {
  it('exposes four media controls for all Chromium operations without showing raw JSON', () => {
    for (const id of [
      'url-pdf',
      'html-pdf',
      'markdown-pdf',
      'url-shot',
      'html-shot',
      'markdown-shot',
    ]) {
      const op = operation(id)
      const media = op.fields.filter((field) => field.section === 'rendering')
      expect(media.map((field) => field.name)).toEqual([
        'mediaColorScheme',
        'mediaReducedMotion',
        'mediaColorGamut',
        'mediaForcedColors',
      ])
      expect(media.every((field) => field.kind === 'select')).toBe(true)
      expect(op.fields.some((field) => field.name === 'emulatedMediaFeatures')).toBe(false)
    }
    expect(operation('office-pdf').fields.some((field) => field.section === 'rendering')).toBe(
      false,
    )
    expect(operation('url-pdf').fields.some((field) => field.name === 'nativePageRanges')).toBe(
      true,
    )
    expect(operation('url-pdf').fields.some((field) => field.name === 'omitBackground')).toBe(true)
  })

  it('serializes selected options into exactly one official Gotenberg JSON array', () => {
    const fields = {
      url: 'https://example.test/page',
      mediaColorScheme: 'dark',
      mediaReducedMotion: 'reduce',
      mediaColorGamut: 'p3',
      mediaForcedColors: 'active',
      printBackground: true,
      omitBackground: true,
      nativePageRanges: '1-3, 5',
    }
    const { payload: valid, operation: op } = payload('url-pdf', fields)
    const form = createGotenbergForm(op, valid, [], [])
    assert.deepEqual(JSON.parse(String(form.get('emulatedMediaFeatures'))), [
      { name: 'prefers-color-scheme', value: 'dark' },
      { name: 'prefers-reduced-motion', value: 'reduce' },
      { name: 'color-gamut', value: 'p3' },
      { name: 'forced-colors', value: 'active' },
    ])
    for (const name of [
      'mediaColorScheme',
      'mediaReducedMotion',
      'mediaColorGamut',
      'mediaForcedColors',
    ]) {
      expect(form.has(name)).toBe(false)
    }
    expect(form.get('omitBackground')).toBe('true')
    expect(form.get('nativePageRanges')).toBe('1-3, 5')
    expect(form.get('printBackground')).toBe('true')
  })

  it('supports partial selections and screenshot media features with no artificial defaults', () => {
    expect(encodeChromiumMediaFeatures({})).toBeUndefined()
    const { payload: valid, operation: op } = payload('url-shot', {
      url: 'https://example.test',
      mediaForcedColors: 'none',
    })
    const form = createGotenbergForm(op, valid, [], [])
    expect(form.get('emulatedMediaFeatures')).toBe('[{"name":"forced-colors","value":"none"}]')
    expect(
      createGotenbergForm(
        operation('url-shot'),
        payload('url-shot', { url: 'https://example.test' }).payload,
        [],
        [],
      ).has('emulatedMediaFeatures'),
    ).toBe(false)
  })

  it('rejects invalid selections, non-Chromium inputs and raw-JSON conflicts', () => {
    expect(() =>
      payload('url-pdf', { url: 'https://example.test', mediaColorScheme: 'banana' }),
    ).toThrow(/Invalid option/)
    expect(() => payload('office-pdf', { mediaColorScheme: 'dark' })).toThrow(/Unsupported field/)
    expect(() =>
      payload(
        'url-pdf',
        { url: 'https://example.test', mediaColorScheme: 'dark' },
        { emulatedMediaFeatures: '[{"name":"color-gamut","value":"p3"}]' },
      ),
    ).toThrow(/UI or Advanced JSON/)
    expect(() =>
      payload('url-pdf', { url: 'https://example.test' }, { emulatedMediaFeatures: '{not-array}' }),
    ).toThrow(/JSON array/)
    expect(() =>
      payload(
        'url-pdf',
        { url: 'https://example.test' },
        { emulatedMediaFeatures: '[{"name":"prefers-color-scheme","value":"dark","secret":1}]' },
      ),
    ).toThrow(/name\/value/)
    expect(() => payload('office-pdf', {}, { emulatedMediaFeatures: '[]' })).toThrow(/Chromium/)
  })

  it('keeps Advanced JSON for uncommon valid media features', () => {
    const { operation: op, payload: valid } = payload(
      'url-pdf',
      { url: 'https://example.test' },
      {
        emulatedMediaFeatures: '[{"name":"dynamic-range","value":"high"}]',
      },
    )
    expect(createGotenbergForm(op, valid, [], []).get('emulatedMediaFeatures')).toBe(
      '[{"name":"dynamic-range","value":"high"}]',
    )
  })
})
