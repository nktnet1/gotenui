import * as v from 'valibot'

/** Validate a scalar-valued JSON object without silently dropping own keys.
 * Valibot record() filters __proto__, constructor and prototype before
 * validating their values. These can be legal HTTP header names, and other
 * callers need to reject unsupported fields rather than lose them.
 */
export function jsonRecord<T>(schema: v.BaseSchema<unknown, T, v.BaseIssue<unknown>>) {
  return v.pipe(
    v.custom<Record<string, T>>((value) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return false
      const prototype = Object.getPrototypeOf(value)
      return (
        (prototype === Object.prototype || prototype === null) &&
        Object.values(value).every((item) => v.is(schema, item))
      )
    }),
    // fromEntries creates own data properties, including for __proto__.
    v.transform((value) => Object.fromEntries(Object.entries(value))),
  )
}
