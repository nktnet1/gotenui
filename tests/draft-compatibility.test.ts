import { describe, expect, test } from 'vitest'
import { OPERATION_BY_ID, operationDefaults } from '#/lib/operations'
import { draftCompatibility } from '#/tools/shared/draft-compatibility'
import {
  activeOperationFields,
  incompatibleOperationFields,
  isFieldVisible,
} from '#/tools/shared/field-visibility'

function operation(id: string) {
  const found = OPERATION_BY_ID.get(id)
  if (!found) throw new Error(`Unknown operation ${id}`)
  return found
}

const emptyDraft = {
  legacyStandaloneOverlay: false,
  acceptsPostProcess: true,
  postProcess: {},
  postFiles: {},
  acceptsArchives: true,
  archives: [],
  acceptsWebhook: true,
  webhookConfigured: false,
  acceptsConversionStages: true,
  conversionStages: '',
  conversionStageFiles: [],
  auxiliary: [],
}

describe('draft compatibility across backend switches', () => {
  test.each([
    ['office-pdf', 'showTrackedChanges', true, '9.9.0', '9.10.0'],
    ['office-pdf', 'showTrackedChanges', true, '8.40.0', '9.10.0'],
    ['office-pdf', 'locale', 'en-AU', '9.8.0', '9.9.0'],
    ['office-pdf', 'generateTaggedPdf', true, '8.37.0', '8.38.0'],
    ['html-pdf', 'failOnConsoleMessageTypes', '["error"]', '8.38.0', '8.39.0'],
    ['html-pdf', 'optimizeImages', true, '8.35.0', '8.36.0'],
    ['html-pdf', 'optimizeImages', true, '9.10.0', '8.40.0'],
    ['html-pdf', 'pdfa', 'PDF/A-4', '8.38.0', '8.39.0'],
    ['html-pdf', 'paperSize', 'A0', '9.4.0', '9.5.0'],
  ] as const)(
    'preserves %s %s until a compatible connection is restored',
    (id, name, value, older, newer) => {
      const spec = operation(id)
      const fields = { ...operationDefaults(spec), [name]: value }
      expect(incompatibleOperationFields(spec, fields, older).map(({ name }) => name)).toContain(
        name,
      )
      expect(activeOperationFields(spec, fields, older)).not.toHaveProperty(name)
      expect(incompatibleOperationFields(spec, fields, newer)).toEqual([])
      expect(activeOperationFields(spec, fields, newer)[name]).toBe(value)
      expect(fields[name]).toBe(value)
    },
  )

  test('untouched defaults, disabled opt-ins and inactive conditional settings do not block', () => {
    const spec = operation('office-pdf')
    expect(
      incompatibleOperationFields(
        spec,
        {
          ...operationDefaults(spec),
          showTrackedChanges: false,
          imageQuality: '75',
          optimizeImages: false,
        },
        '8.35.0',
      ),
    ).toEqual([])
    expect(incompatibleOperationFields(spec, operationDefaults(spec), '9.10.0')).toEqual([])
    expect(
      incompatibleOperationFields(
        operation('html-pdf'),
        { failOnConsoleMessageTypes: '["error"]' },
        '9.0.0',
      ),
    ).toEqual([])
    expect(incompatibleOperationFields(spec, { generateTaggedPdf: true }, '9.0.0')).toEqual([])
  })

  test('detects legacy post-processing and files on a v9 conversion without mutating them', () => {
    const file = new File(['data'], 'image.png')
    const draft = {
      ...emptyDraft,
      acceptsPostProcess: false,
      postProcess: { flatten: true },
      postFiles: { stamp: file },
    }
    const result = draftCompatibility(operation('html-pdf'), {}, '9.10.0', draft)
    expect(result.discardPostProcess).toBe(true)
    expect(result.reasons).toHaveLength(1)
    expect(draft.postFiles.stamp).toBe(file)
    expect(
      draftCompatibility(operation('html-pdf'), {}, '8.40.0', {
        ...draft,
        acceptsPostProcess: true,
      }).reasons,
    ).toEqual([])
  })

  test('blocks ZIPs, webhooks, stages and stage files when unavailable', () => {
    const file = new File(['data'], 'asset.pdf')
    const result = draftCompatibility(operation('office-pdf'), {}, '8.40.0', {
      ...emptyDraft,
      acceptsArchives: false,
      archives: [file],
      acceptsWebhook: false,
      webhookConfigured: true,
      acceptsConversionStages: false,
      conversionStages: '[{"op":"merge"}]',
      conversionStageFiles: [file],
    })
    expect(result).toMatchObject({
      discardArchives: true,
      discardWebhook: true,
      discardStages: true,
    })
    expect(result.reasons).toHaveLength(3)
  })

  test('does not silently translate the standalone overlay editor between majors', () => {
    const spec = operation('stamp')
    const result = draftCompatibility(spec, { v9OverlayPosition: 'center' }, '8.40.0', {
      ...emptyDraft,
      legacyStandaloneOverlay: true,
      auxiliary: [new File(['data'], 'stamp.png')],
    })
    expect(result.discardAuxiliary).toBe(true)
    expect(result.fieldConflicts.map(({ name }) => name)).toContain('v9OverlayPosition')
  })

  test('resource exclusions are inactive when asset status checks are disabled', () => {
    const field = operation('html-pdf').fields.find(
      ({ name }) => name === 'ignoreResourceHttpStatusDomains',
    )
    if (!field) throw new Error('Missing resource exclusions')
    for (const value of ['', '[]', '[ ]'])
      expect(isFieldVisible(field, { failOnResourceHttpStatusCodes: value })).toBe(false)
    expect(isFieldVisible(field, { failOnResourceHttpStatusCodes: '404' })).toBe(true)
  })
})

describe('unverified versions and version-dependent field values', () => {
  test.each([undefined, 'Unavailable', 'Unknown', '10.0.0'])(
    'does not classify retained settings on %s',
    (version) => {
      const file = new File(['data'], 'archive.zip')
      const spec = operation('office-pdf')
      const values = { showTrackedChanges: true, locale: 'en-AU' }
      const result = draftCompatibility(spec, values, version, {
        ...emptyDraft,
        acceptsArchives: false,
        archives: [file],
        acceptsPostProcess: false,
        postProcess: { flatten: true },
        acceptsWebhook: false,
        webhookConfigured: true,
        acceptsConversionStages: false,
        conversionStages: '[{"op":"merge"}]',
      })
      expect(result.reasons).toEqual([])
      expect(result.fieldConflicts).toEqual([])
      expect(result.discardArchives).toBe(false)
      expect(result.discardPostProcess).toBe(false)
      expect(result.discardWebhook).toBe(false)
      expect(result.discardStages).toBe(false)
      expect(activeOperationFields(spec, values, version)).toEqual(values)
    },
  )

  test.each([
    ['office-pdf', { openBookmarkLevels: '20' }, 'openBookmarkLevels'],
    ['office-pdf', { openBookmarkLevels: '0' }, 'openBookmarkLevels'],
    ['html-shot', { format: 'jpeg', quality: '0' }, 'quality'],
  ] as const)('detects a migrated value for %s', (id, values, name) => {
    const spec = operation(id)
    expect(incompatibleOperationFields(spec, values, '8.40.0')).toEqual([])
    expect(
      incompatibleOperationFields(spec, values, '9.10.0').map((field) => field.name),
    ).toContain(name)
    expect(activeOperationFields(spec, values, '9.10.0')).not.toHaveProperty(name)
  })
})
