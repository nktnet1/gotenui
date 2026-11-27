/** JSON strings may contain isolated UTF-16 surrogates even after a successful
 * parse. Go JSON decoding and browser multipart encoding replace them with
 * U+FFFD, which changes source text, identifiers and secrets. Only inspect
 * acyclic JSON values or schema-validated payloads.
 */
export function hasMalformedUnicode(value: unknown): boolean {
  const pending = [value]
  while (pending.length) {
    const current = pending.pop()
    if (typeof current === 'string') {
      if (/\p{Cs}/u.test(current)) return true
    } else if (current && typeof current === 'object') {
      for (const [key, item] of Object.entries(current)) {
        if (/\p{Cs}/u.test(key)) return true
        pending.push(item)
      }
    }
  }
  return false
}

/** Go's strings.TrimSpace uses Unicode White_Space, not JavaScript trim. */
export function trimGoWhitespace(value: string): string {
  return value.replace(/^\p{White_Space}+|\p{White_Space}+$/gu, '')
}
