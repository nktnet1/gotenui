import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { ConversionPresets } from '#/components/conversion-presets'
import {
  applyPresetFields,
  capturePresetFields,
  loadPresets,
  MAX_PRESETS,
  PRESETS_STORAGE_KEY,
  persistPresets,
  reusableFieldNames,
  upsertPreset,
} from '#/lib/conversion-presets'
import { OPERATION_BY_ID, OPERATIONS } from '#/lib/operations'

function requiredOperation(id: string) {
  const operation = OPERATION_BY_ID.get(id)
  assert.ok(operation)
  return operation
}

const operation = requiredOperation('url-pdf')
const office = requiredOperation('office-pdf')
const firstId = 'preset-00000000-0000-4000-8000-000000000001'
const secondId = 'preset-00000000-0000-4000-8000-000000000002'

function storage() {
  const items = new Map<string, string>()
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    items,
  }
}

const sensitive = {
  url: 'https://private.example/doc?token=secret',
  password: 'office-password',
  userPassword: 'open-password',
  ownerPassword: 'owner-password',
  cookies: '{"access":"secret"}',
  extraHttpHeaders: 'Bearer super-secret',
  waitForExpression: 'document.cookie',
  waitForSelector: '#secret',
  userAgent: 'User secret info',
  metadata: '{"Title":"Private"}',
  webhookUrl: 'https://callback.example/secret',
  downloadFrom: 'https://private.example/token',
  outputName: 'customer-name',
  advanced: '{"password":"secret"}',
}

describe('browser-local operation presets', () => {
  it('includes only known benign input controls, never free text, URLs, passwords or JSON', () => {
    for (const op of OPERATIONS) {
      const allowed = reusableFieldNames(op)
      assert.ok(allowed.every((name) => op.fields.some((field) => field.name === name)))
      for (const field of op.fields) {
        if (['password', 'url', 'json'].includes(field.kind)) {
          assert.ok(!allowed.includes(field.name), `${op.id}.${field.name}`)
        }
      }
    }
    expect(reusableFieldNames(operation)).toContain('landscape')
    expect(reusableFieldNames(operation)).not.toContain('url')
    for (const secretField of Object.keys(sensitive)) {
      expect(reusableFieldNames(operation)).not.toContain(secretField)
    }
  })

  it('captures only safe settings and retains intentional false values', () => {
    const fields = capturePresetFields(operation, {
      ...sensitive,
      landscape: false,
      paperWidth: '8.27in',
      marginTop: '0.8in',
      scale: '1.25',
      pdfa: 'PDF/A-2b',
      printBackground: true,
    })
    expect(fields).toEqual({
      paperWidth: '8.27in',
      landscape: false,
      printBackground: true,
      marginTop: '0.8in',
      scale: '1.25',
      pdfa: 'PDF/A-2b',
    })
    const saved = upsertPreset([], operation, ' A4 print ', { ...sensitive, ...fields }, firstId)
    const serialized = JSON.stringify(saved)
    for (const secret of Object.values(sensitive)) expect(serialized).not.toContain(secret)
  })

  it('preserves safe Office viewer choices but excludes source passwords', () => {
    expect(
      capturePresetFields(office, {
        ...sensitive,
        nativePageRanges: '1-3, 5',
        initialView: '1',
        initialPage: '4',
        zoom: '125',
        exportFormFields: false,
      }),
    ).toEqual({
      nativePageRanges: '1-3, 5',
      exportFormFields: false,
      initialView: '1',
      initialPage: '4',
      zoom: '125',
    })
  })

  it('rejects malicious or incorrect values for each allowed field type', () => {
    const invalid: Record<string, string | boolean>[] = [
      { scale: 'Infinity' },
      { scale: '3' },
      { scale: '1<script>' },
      { scale: '-1' },
      { landscape: 'true' },
      { pdfa: 'PDF/A-invented' },
      { paperWidth: 'secret-input' },
      { marginTop: '1in;token=secret' },
      { waitDelay: '2s,Authorization' },
    ]
    for (const fields of invalid) {
      expect(() => capturePresetFields(operation, fields)).toThrow(/Invalid/)
    }
    const invalidOffice: Record<string, string | boolean>[] = [
      { initialPage: '0' },
      { initialPage: '4.5' },
      { nativePageRanges: 'https://private.example' },
    ]
    for (const fields of invalidOffice)
      expect(() => capturePresetFields(office, fields)).toThrow(/Invalid/)
  })

  it('accepts reasonable numeric, viewport, duration and page-range presets', () => {
    const screenshot = requiredOperation('url-shot')
    expect(
      capturePresetFields(screenshot, {
        width: '1920',
        height: '1080',
        format: 'webp',
        quality: '80',
        waitDelay: '200ms',
        selector: '[secret]',
      }),
    ).toEqual({
      width: '1920',
      height: '1080',
      format: 'webp',
      quality: '80',
      waitDelay: '200ms',
    })
  })

  it('loads and applies an exact preset while leaving private in-memory inputs untouched', () => {
    const stored = storage()
    const saved = upsertPreset(
      [],
      operation,
      'Print A4',
      {
        landscape: true,
        pdfa: 'PDF/A-2b',
        paperWidth: '8.27in',
        ...sensitive,
      },
      firstId,
    )
    expect(persistPresets(stored, saved)).toBe(true)
    const json = stored.items.get(PRESETS_STORAGE_KEY) ?? ''
    expect(json).toContain('Print A4')
    expect(json).not.toContain('private.example')
    expect(json).not.toContain('password')
    const [loaded] = loadPresets(stored)
    assert.ok(loaded)
    const restored = applyPresetFields(
      operation,
      {
        landscape: false,
        pdfa: 'PDF/A-3b',
        marginTop: '2in',
        ...sensitive,
      },
      loaded,
    )
    expect(restored).toMatchObject({
      landscape: true,
      pdfa: 'PDF/A-2b',
      paperWidth: '8.27in',
      ...sensitive,
    })
    expect(restored).not.toHaveProperty('marginTop')
  })

  it('applies saved settings only to the matching operation', () => {
    const preset = upsertPreset([], operation, 'Only URL', { landscape: true }, firstId)[0]
    assert.ok(preset)
    expect(() => applyPresetFields(office, { landscape: false }, preset)).toThrow(
      /another operation/,
    )
    expect(() =>
      applyPresetFields(operation, {}, { ...preset, fields: { url: 'secret' } }),
    ).toThrow(/unsupported/)
  })

  it('restores operation defaults for omitted reusable controls', () => {
    const screenshot = requiredOperation('url-shot')
    const preset = upsertPreset([], screenshot, 'Custom width', { width: '1920' }, firstId)[0]
    assert.ok(preset)
    const applied = applyPresetFields(
      screenshot,
      { width: '1200', height: '768', format: 'jpeg', url: 'https://private.test' },
      preset,
    )
    expect(applied).toEqual({
      width: '1920',
      height: '900',
      format: 'png',
      url: 'https://private.test',
    })
  })

  it('updates an existing name without changing its identifier or operation', () => {
    const saved = upsertPreset([], operation, 'Print A4', { landscape: false }, firstId)
    const updated = upsertPreset(saved, operation, 'print a4', { landscape: true }, secondId)
    expect(updated).toHaveLength(1)
    expect(updated[0]).toMatchObject({ id: firstId, name: 'print a4', fields: { landscape: true } })
    const other = upsertPreset(updated, office, 'Print A4', { landscape: true }, secondId)
    expect(other).toHaveLength(2)
    expect(other[1]?.operationId).toBe('office-pdf')
  })

  it('enforces name and storage count limits while allowing edits at capacity', () => {
    for (const name of ['', ' ', '\r\n', 'x'.repeat(61)]) {
      expect(() => upsertPreset([], operation, name, {}, firstId)).toThrow(/name/)
    }
    const full = Array.from({ length: MAX_PRESETS }, (_, index) => {
      const preset = upsertPreset(
        [],
        operation,
        `Preset ${index}`,
        {},
        `preset-00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      )[0]
      assert.ok(preset)
      return preset
    })
    expect(() => upsertPreset(full, operation, 'Additional', {}, secondId)).toThrow(/up to/)
    expect(upsertPreset(full, operation, 'Preset 0', { landscape: true }, secondId)).toHaveLength(
      MAX_PRESETS,
    )
  })

  it('fails closed for malformed, oversized, duplicate, and malicious storage data', () => {
    const stored = storage()
    for (const raw of [
      'not JSON',
      '{}',
      'x'.repeat(64_001),
      JSON.stringify({ version: 2, presets: [] }),
      JSON.stringify({
        version: 1,
        presets: [{ id: firstId, operationId: 'url-pdf', name: 'X', fields: { url: 'secret' } }],
      }),
      JSON.stringify({
        version: 1,
        presets: [
          { id: firstId, operationId: 'url-pdf', name: 'X', fields: { scale: 'Infinity' } },
        ],
      }),
      JSON.stringify({
        version: 1,
        presets: [{ id: firstId, operationId: 'unknown', name: 'X', fields: {} }],
      }),
      JSON.stringify({
        version: 1,
        presets: [
          { id: firstId, operationId: 'url-pdf', name: 'X', fields: {} },
          { id: firstId, operationId: 'url-pdf', name: 'Y', fields: {} },
        ],
      }),
      JSON.stringify({
        version: 1,
        presets: [{ id: firstId, operationId: 'url-pdf', name: 'X', fields: {}, extra: 'secret' }],
      }),
    ]) {
      stored.setItem(PRESETS_STORAGE_KEY, raw)
      expect(loadPresets(stored), raw.slice(0, 50)).toEqual([])
    }
  })

  it('does not leak arbitrary keys during persistence, even from caller data', () => {
    const stored = storage()
    const preset = upsertPreset([], operation, 'Test', { landscape: true }, firstId)[0]
    assert.ok(preset)
    expect(
      persistPresets(stored, [{ ...preset, fields: { authorization: 'Bearer secret' } }]),
    ).toBe(false)
    expect(stored.getItem(PRESETS_STORAGE_KEY)).toBeNull()
    expect(persistPresets(stored, [{ ...preset, fields: { landscape: 'true' } }])).toBe(false)
    expect(stored.getItem(PRESETS_STORAGE_KEY)).toBeNull()
  })

  it('handles storage denial and quota errors without throwing', () => {
    const broken = {
      getItem: (): string => {
        throw new Error('storage denied')
      },
      setItem: (): void => {
        throw new Error('storage denied')
      },
    }
    expect(loadPresets(broken)).toEqual([])
    expect(persistPresets(broken, [])).toBe(false)
    expect(persistPresets(null, [])).toBe(false)
  })

  it('does not offer meaningless presets for operations without reusable settings', () => {
    const flatten = requiredOperation('flatten')
    expect(reusableFieldNames(flatten)).toEqual([])
    expect(() => upsertPreset([], flatten, 'Anything', {}, firstId)).toThrow(/no reusable/)
    expect(
      renderToStaticMarkup(
        createElement(ConversionPresets, {
          operation: flatten,
          fields: {},
          onApply: vi.fn(),
        }),
      ),
    ).toBe('')
  })

  it('renders labelled, keyboard-friendly controls and the privacy notice', () => {
    const html = renderToStaticMarkup(
      createElement(ConversionPresets, {
        operation,
        fields: { landscape: true },
        onApply: vi.fn(),
      }),
    )
    expect(html).toContain('Saved operation presets')
    expect(html).toContain('Preset name')
    expect(html).toContain('Save preset')
    expect(html).toContain('never URLs, documents, uploads, passwords, cookies, headers')
    expect(html).not.toContain(sensitive.url)
  })
})
