import { goFiniteFloat } from '#/lib/go-form-values'
import type { FieldDefinition } from '#/tools/types'

const decimalIntegerPattern = /^[+-]?\d+$/
const decimalNumberPattern = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/
const minGoInt = -(1n << 63n)
export const maxGoInt = (1n << 63n) - 1n

/** Native form bindings use Go numeric grammar, while PDF tools also encode JSON numbers. */
export function isNumberFieldValue(
  field: Pick<FieldDefinition, 'integer' | 'min' | 'max'>,
  value: string,
  native: boolean,
): boolean {
  const integer = field.integer === true
  const validSpelling = (integer ? decimalIntegerPattern : decimalNumberPattern).test(value)
  const n = !integer && native ? goFiniteFloat(value) : validSpelling ? Number(value) : undefined
  const goInt = integer && validSpelling ? BigInt(value) : undefined
  return (
    n !== undefined &&
    Number.isFinite(n) &&
    (!integer || native || Number.isSafeInteger(n)) &&
    (field.min === undefined || n >= field.min) &&
    (field.max === undefined || n <= field.max) &&
    (goInt === undefined || (goInt >= minGoInt && goInt <= maxGoInt))
  )
}
