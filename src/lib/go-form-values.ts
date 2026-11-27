/** Match finite floating-point spellings accepted by Go's form bindings.
 * JavaScript alone accepts invalid spellings such as whitespace or bare 0x10.
 */
const decimalDigits = '[0-9](?:_?[0-9])*'
const hexDigits = '[0-9a-fA-F](?:_?[0-9a-fA-F])*'
const decimal = new RegExp(
  `^[+-]?(?:${decimalDigits}(?:\\.(?:${decimalDigits})?)?|\\.${decimalDigits})(?:[eE][+-]?${decimalDigits})?$`,
)
const hexadecimal = new RegExp(
  `^([+-]?)0[xX](_?${hexDigits}(?:\\.(?:${hexDigits})?)?|\\.${hexDigits})[pP]([+-]?${decimalDigits})$`,
)

export function goFiniteFloat(value: string): number | undefined {
  if (decimal.test(value)) {
    const number = Number(value.replaceAll('_', ''))
    return Number.isFinite(number) ? number : undefined
  }
  const match = hexadecimal.exec(value)
  if (!match) return undefined
  const [whole, fraction = ''] = match[2].replaceAll('_', '').split('.')
  const significant = `${whole}${fraction}`.replace(/^0+/, '')
  const sign = match[1] === '-' ? -1 : 1
  if (!significant) return sign * 0

  const leadingBits = Math.floor(Math.log2(Number.parseInt(significant[0], 16))) + 1
  const exponent = Number(match[3].replaceAll('_', ''))
  const highestBit = exponent + 4 * (significant.length - 1 - fraction.length) + leadingBits - 1
  if (highestBit > 1023) return undefined
  if (highestBit < -1075) return sign * 0

  // Round to binary64, including subnormals. Only a bounded leading portion
  // of the mantissa is needed, with a sticky bit for any remaining digits.
  const quantum = Math.max(-1074, highestBit - 52)
  const keepBits = highestBit - quantum + 1
  const head = significant.slice(0, 15)
  const headBits = 4 * (head.length - 1) + leadingBits
  const shift = headBits - keepBits
  const integer = BigInt(`0x${head}`)
  let rounded: bigint
  if (shift <= 0) {
    rounded = integer << BigInt(-shift)
  } else {
    const bits = BigInt(shift)
    rounded = integer >> bits
    const remainder = integer - (rounded << bits)
    const half = 1n << (bits - 1n)
    const sticky = /[^0]/.test(significant.slice(head.length))
    if (remainder > half || (remainder === half && (sticky || (rounded & 1n) !== 0n))) {
      rounded++
    }
  }
  const number = sign * Number(rounded) * 2 ** quantum
  return Number.isFinite(number) ? number : undefined
}

const inchesPerUnit = { pt: 1 / 72, px: 1 / 96, in: 1, mm: 1 / 25.4, cm: 1 / 2.54, pc: 1 / 6 }

export function goFormLength(value: string): number | undefined {
  for (const [unit, ratio] of Object.entries(inchesPerUnit)) {
    if (value.endsWith(unit)) {
      const number = goFiniteFloat(value.slice(0, -unit.length))
      return number === undefined ? undefined : number * ratio
    }
  }
  return goFiniteFloat(value)
}

export function isGoFormBoolean(value: string): boolean {
  return ['1', 't', 'T', 'true', 'TRUE', 'True', '0', 'f', 'F', 'false', 'FALSE', 'False'].includes(
    value,
  )
}
