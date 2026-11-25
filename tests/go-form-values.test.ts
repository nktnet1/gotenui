import assert from 'node:assert/strict'
import { test } from 'vitest'
import { goFiniteFloat, goFormLength, isGoFormBoolean } from '#/lib/go-form-values'

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
