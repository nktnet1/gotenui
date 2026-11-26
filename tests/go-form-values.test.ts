import assert from 'node:assert/strict'
import { test } from 'vitest'
import { goFiniteFloat, goFormLength, isGoFormBoolean } from '#/lib/go-form-values'
import { createGotenbergForm } from '#/lib/gotenberg-client'
import { v8WatermarkRotationTenths } from '#/lib/official-form-fields'
import { validatePayload } from '#/lib/validation'

test('Go floating-point validation accepts decimal and hexadecimal numeric spellings', () => {
  for (const [raw, expected] of [
    ['+12.5e-1', 1.25],
    ['1_000.0_5', 1000.05],
    ['.5', 0.5],
    ['0x1.8p+2', 6],
    ['-0X_1.P-2', -0.25],
    ['0x.8p0', 0.5],
    ['0x1.fffffffffffffp1023', Number.MAX_VALUE],
    ['0x1p-1074', Number.MIN_VALUE],
    ['0x1.8p-1075', Number.MIN_VALUE],
    ['0x1p-1075', 0],
    ['0x1.00000000000000001p-1075', Number.MIN_VALUE],
    ['-0x0p999999', -0],
    ['0x1.00000000000008p0', 1],
    ['0x1.0000000000000800001p0', 1 + Number.EPSILON],
  ] as const)
    assert.equal(goFiniteFloat(raw), expected, raw)
})

test('Go floating-point validation rejects invalid or non-finite numbers', () => {
  for (const raw of [
    '',
    ' ',
    '1\n',
    '0x10',
    '1__2',
    '0x_1_p0',
    '0x1p',
    'NaN',
    'Infinity',
    '1e999',
    '0x1p1024',
    '0x1.fffffffffffff8p1023',
    '45deg',
  ]) {
    assert.equal(goFiniteFloat(raw), undefined, raw)
  }
})

test('Go length validation applies the backend unit ratios', () => {
  for (const raw of ['1', '72pt', '96px', '1in', '6pc']) assert.equal(goFormLength(raw), 1, raw)
  assert.equal(goFormLength('25.4mm'), 25.4 * (1 / 25.4))
  assert.equal(goFormLength('2.54cm'), 2.54 * (1 / 2.54))
  for (const raw of ['1em', '2in\n', '2 IN', '1.2.3mm'])
    assert.equal(goFormLength(raw), undefined, raw)
  assert.equal(goFormLength('1e-323px'), 0)
})

test('Go boolean validation retains every accepted spelling', () => {
  for (const value of [
    '1',
    't',
    'T',
    'true',
    'TRUE',
    'True',
    '0',
    'f',
    'F',
    'false',
    'FALSE',
    'False',
  ])
    assert.equal(isGoFormBoolean(value), true)
  for (const value of ['', 'yes', 'on', ' true', 'TrUe', 'false\n', '2'])
    assert.equal(isGoFormBoolean(value), false)
})

test('native Chromium and LibreOffice numeric controls accept Go float spellings', () => {
  const cases = [
    { operation: 'url-pdf', fields: { url: 'https://example.test', scale: '0x1.8p0' } },
    { operation: 'url-shot', fields: { url: 'https://example.test', deviceScaleFactor: '1_0e-1' } },
    {
      operation: 'office-pdf',
      fields: { nativeWatermarkText: 'DRAFT', nativeWatermarkRotateAngle: '0x1.8p2' },
    },
  ]
  for (const candidate of cases) {
    const { payload, operation } = validatePayload({ ...candidate, advanced: {} })
    const files = operation.input === 'office' ? [new File(['Office document'], 'report.docx')] : []
    const form = createGotenbergForm(operation, payload, files, [], 4_000_000, {}, [], 9)
    const key = Object.keys(candidate.fields).at(-1) as string
    assert.equal(form.get(key), payload.fields[key])
  }
})

test('v8 watermark rotation never silently rounds non-tenths or overflows its integer encoding', () => {
  for (const value of ['0.000000001', '0.30000000000000004', '1e30'])
    assert.equal(v8WatermarkRotationTenths(value), null, value)
  for (const [value, tenths] of [
    ['0.3', 3],
    ['-22.5', -225],
    ['0x1.8p2', 60],
  ] as const)
    assert.equal(v8WatermarkRotationTenths(value), tenths, value)
})
