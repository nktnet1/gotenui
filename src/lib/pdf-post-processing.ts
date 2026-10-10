import * as v from 'valibot'

/** Only PDF-producing conversion routes accept PDF-engine options in the same request. */
export const PDF_CONVERSION_IDS = new Set(['url-pdf', 'html-pdf', 'markdown-pdf', 'office-pdf'])

const overlaySchema = v.strictObject({
  source: v.picklist(['text', 'image', 'pdf']),
  expression: v.optional(v.pipe(v.string(), v.maxLength(2_000))),
  pages: v.optional(v.pipe(v.string(), v.maxLength(200))),
  options: v.optional(v.pipe(v.string(), v.maxLength(4_000))),
})

export const pdfPostProcessSchema = v.strictObject({
  watermark: v.optional(overlaySchema),
  stamp: v.optional(overlaySchema),
  metadata: v.optional(v.pipe(v.string(), v.maxLength(10_000))),
  embedsMetadata: v.optional(v.pipe(v.string(), v.maxLength(10_000))),
  facturxConformanceLevel: v.optional(
    v.picklist(['MINIMUM', 'BASIC WL', 'BASIC', 'EN 16931', 'EXTENDED', 'XRECHNUNG']),
  ),
  facturxDocumentType: v.optional(
    v.picklist(['INVOICE', 'ORDER', 'ORDER_RESPONSE', 'ORDER_CHANGE']),
  ),
  facturxVersion: v.optional(v.pipe(v.string(), v.maxLength(30))),
  flatten: v.optional(v.boolean()),
  userPassword: v.optional(v.pipe(v.string(), v.maxLength(256))),
  ownerPassword: v.optional(v.pipe(v.string(), v.maxLength(256))),
  allowPrinting: v.optional(v.boolean()),
  allowCopying: v.optional(v.boolean()),
  allowModifying: v.optional(v.boolean()),
  allowAnnotating: v.optional(v.boolean()),
  allowFillingForms: v.optional(v.boolean()),
  allowAssembling: v.optional(v.boolean()),
})

export type PdfPostProcess = v.InferOutput<typeof pdfPostProcessSchema>
export type OverlaySettings = NonNullable<PdfPostProcess['watermark']>

/** Files remain in request memory. Nothing is persisted on the Gotenui server. */
export type PostProcessFiles = {
  watermark?: File
  stamp?: File
  embeds?: File[]
  facturxXml?: File
}

/** Convert validated settings to distinct scalar Gotenberg fields, omitting unset options. */
export function postProcessFormFields(
  settings: PdfPostProcess,
  files: PostProcessFiles,
): [string, string][] {
  const entries: [string, string][] = []
  for (const kind of ['watermark', 'stamp'] as const) {
    const overlay = settings[kind]
    if (!overlay) continue
    entries.push([`${kind}Source`, overlay.source])
    const expression =
      overlay.source === 'text' ? overlay.expression : (files[kind]?.name ?? overlay.expression)
    if (expression) entries.push([`${kind}Expression`, expression])
    if (overlay.pages) entries.push([`${kind}Pages`, overlay.pages])
    if (overlay.options) entries.push([`${kind}Options`, overlay.options])
  }
  for (const [name, value] of Object.entries(settings)) {
    if (name === 'watermark' || name === 'stamp' || value === undefined || value === '') continue
    entries.push([name, String(value)])
  }
  return entries
}

export function countPostProcessFiles(files: PostProcessFiles): number {
  return (
    Number(Boolean(files.watermark)) +
    Number(Boolean(files.stamp)) +
    (files.embeds?.length ?? 0) +
    Number(Boolean(files.facturxXml))
  )
}
