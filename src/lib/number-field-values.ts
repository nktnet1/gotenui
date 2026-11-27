import { goFiniteFloat } from '#/lib/go-form-values'
import type { FieldDefinition } from '#/tools/types'

const decimalIntegerPattern = /^[+-]?\d+$/
const decimalNumberPattern = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/
/** Bound integer conversion before constructing a BigInt, even for long form values. */
export function parseGoFormInteger(value: string): bigint | undefined {
  if (!decimalIntegerPattern.test(value)) return undefined
  const negative = value.startsWith('-')
  const digits = value.replace(/^[+-]?0*/, '') || '0'
  const limit = negative ? '9223372036854775808' : '9223372036854775807'
  if (digits.length > limit.length || (digits.length === limit.length && digits > limit))
    return undefined
  return BigInt(negative ? `-${digits}` : digits)
}

/** Native form bindings use Go numeric grammar, while PDF tools also encode JSON numbers. */
export function isNumberFieldValue(
  field: Pick<FieldDefinition, 'integer' | 'min' | 'max'>,
  value: string,
  native: boolean,
): boolean {
  const integer = field.integer === true
  const goInt = integer ? parseGoFormInteger(value) : undefined
  const n = integer
    ? goInt === undefined
      ? undefined
      : Number(goInt)
    : native
      ? goFiniteFloat(value)
      : decimalNumberPattern.test(value)
        ? Number(value)
        : undefined
  return (
    n !== undefined &&
    Number.isFinite(n) &&
    (!integer || native || Number.isSafeInteger(n)) &&
    (field.min === undefined || n >= field.min) &&
    (field.max === undefined || n <= field.max)
  )
}
