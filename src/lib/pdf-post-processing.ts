import * as v from 'valibot'

/** PDF-producing conversions share the native PDF-engine post-processing fields. */
export const PDF_CONVERSION_IDS = new Set(['url-pdf', 'html-pdf', 'markdown-pdf', 'office-pdf'])

/** Merge and Split accept those same fields on the upstream PDF Engines routes. */
export const PDF_POST_PROCESS_IDS = new Set([...PDF_CONVERSION_IDS, 'merge', 'split'])
export const OVERLAY_KINDS = ['watermark', 'stamp'] as const
export type OverlayKind = (typeof OVERLAY_KINDS)[number]

const overlaySchema = v.strictObject({
  source: v.picklist(['text', 'image', 'pdf']),
  expression: v.optional(v.pipe(v.string(), v.maxLength(2_000))),
  pages: v.optional(v.pipe(v.string(), v.maxLength(200))),
  options: v.optional(v.pipe(v.string(), v.maxLength(4_000))),
})

export const pdfPostProcessSchema = v.strictObject({
  // Retain v1.0.21's single-overlay contract for existing clients.
  watermark: v.optional(overlaySchema),
  stamp: v.optional(overlaySchema),
  // Ordered, nonempty lists for Gotenberg 8.36+ parallel multipart parameters.
  watermarks: v.optional(v.pipe(v.array(overlaySchema), v.minLength(1), v.maxLength(10))),
  stamps: v.optional(v.pipe(v.array(overlaySchema), v.minLength(1), v.maxLength(10))),
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
  rotateAngle: v.optional(v.picklist(['90', '180', '270'])),
  rotatePages: v.optional(v.pipe(v.string(), v.maxLength(200))),
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
export type OverlaySettings = v.InferOutput<typeof overlaySchema>

/** Files remain in request memory. The File union supports v1.0.21 callers. */
export type PostProcessFiles = {
  watermark?: File | File[]
  stamp?: File | File[]
  embeds?: File[]
  facturxXml?: File
}

export function overlayUploads(files: PostProcessFiles, kind: OverlayKind): File[] {
  const value = files[kind]
  return value ? (Array.isArray(value) ? value : [value]) : []
}

export function configuredOverlays(settings: PdfPostProcess, kind: OverlayKind): OverlaySettings[] {
  const repeated = kind === 'watermark' ? settings.watermarks : settings.stamps
  const single = settings[kind]
  return repeated ?? (single ? [single] : [])
}

/** Gotenberg consumes uploaded overlay files in the order of their configured rows. */
export function orderedOverlayUploads(
  settings: PdfPostProcess,
  files: PostProcessFiles,
  kind: OverlayKind,
): File[] {
  const uploads = overlayUploads(files, kind)
  const rows = configuredOverlays(settings, kind)
  if (rows.length === 1 && !rows[0]?.expression) return uploads
  return rows.flatMap((row) =>
    row.source === 'text' ? [] : uploads.filter((file) => file.name === row.expression),
  )
}

/** Return ordered entries rather than an object: repeated keys must be appended, not set. */
export function postProcessFormFields(
  settings: PdfPostProcess,
  files: PostProcessFiles,
): [string, string][] {
  const entries: [string, string][] = []
  for (const kind of OVERLAY_KINDS) {
    const overlays = configuredOverlays(settings, kind)
    for (const overlay of overlays) {
      const expression =
        overlay.expression ??
        (overlays.length === 1 && overlay.source !== 'text'
          ? (overlayUploads(files, kind)[0]?.name ?? '')
          : '')
      // Gotenberg reads four parallel lists by index, including empty values.
      entries.push(
        [`${kind}Source`, overlay.source],
        [`${kind}Expression`, expression],
        [`${kind}Pages`, overlay.pages ?? ''],
        [`${kind}Options`, overlay.options ?? ''],
      )
    }
  }
  for (const [name, value] of Object.entries(settings)) {
    if (
      name === 'watermark' ||
      name === 'stamp' ||
      name === 'watermarks' ||
      name === 'stamps' ||
      value === undefined ||
      value === ''
    ) {
      continue
    }
    entries.push([name, String(value)])
  }
  return entries
}

export function countPostProcessFiles(files: PostProcessFiles): number {
  return (
    overlayUploads(files, 'watermark').length +
    overlayUploads(files, 'stamp').length +
    (files.embeds?.length ?? 0) +
    Number(Boolean(files.facturxXml))
  )
}
