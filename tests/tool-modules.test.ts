import { expect, test } from 'vitest'
import { FieldControl as AppFieldControl } from '#/components/gotenui-app'
import {
  activeOperationFields as legacyActiveFields,
  OPERATION_BY_ID as legacyById,
  operationDefaults as legacyDefaults,
  isFieldVisible as legacyFieldVisibility,
  GROUPS as legacyGroups,
  OPERATIONS as legacyOperations,
} from '#/lib/operations'
import {
  activeOperationFields,
  GROUPS,
  isFieldVisible,
  OPERATION_BY_ID,
  OPERATIONS,
  type Operation,
  operationDefaults,
} from '#/tools/registry'
import { FieldControl } from '#/tools/shared/tool-fields'

// Vite discovers all tool config modules independently of the manually ordered registry.
// A new module that is not registered, or an orphaned registry entry, must fail CI.
const toolModules = import.meta.glob('../src/tools/*/config.ts', {
  eager: true,
  import: 'operation',
}) as Record<string, Operation>

const orderedIds = [
  'url-pdf',
  'html-pdf',
  'markdown-pdf',
  'office-pdf',
  'url-shot',
  'html-shot',
  'markdown-shot',
  'merge',
  'split',
  'pdfa',
  'optimize',
  'rotate',
  'flatten',
  'encrypt',
  'watermark',
  'stamp',
  'metadata-read',
  'metadata-write',
  'bookmarks-read',
  'bookmarks-write',
  'embed',
  'factur-x',
]

test('every independent tool module is registered exactly once and preserves tool order', () => {
  expect(OPERATIONS.map(({ id }) => id)).toEqual(orderedIds)
  expect(Object.keys(toolModules)).toHaveLength(orderedIds.length)
  expect(OPERATION_BY_ID.size).toBe(orderedIds.length)
  for (const operation of OPERATIONS) {
    const key = `../src/tools/${operation.id}/config.ts`
    expect(toolModules[key], `${key} must exist and be the registered instance`).toBe(operation)
    expect(OPERATION_BY_ID.get(operation.id)).toBe(operation)
  }
})

test('legacy operation imports and field renderer remain referentially compatible', () => {
  expect(legacyOperations).toBe(OPERATIONS)
  expect(legacyById).toBe(OPERATION_BY_ID)
  expect(legacyGroups).toBe(GROUPS)
  expect(legacyDefaults).toBe(operationDefaults)
  expect(legacyFieldVisibility).toBe(isFieldVisible)
  expect(legacyActiveFields).toBe(activeOperationFields)
  expect(AppFieldControl).toBe(FieldControl)
})

test('shared field groups are composed without duplicating their definitions per tool', () => {
  const html = OPERATION_BY_ID.get('html-pdf')
  const markdown = OPERATION_BY_ID.get('markdown-pdf')
  const url = OPERATION_BY_ID.get('url-pdf')
  const merge = OPERATION_BY_ID.get('merge')
  expect(html?.fields).toBe(markdown?.fields)
  expect(url?.fields.slice(1)).toEqual(html?.fields)
  expect(merge?.fields.some(({ name }) => name === 'metadata')).toBe(true)
})
