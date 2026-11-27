import { isAttachmentMimeType } from '#/lib/attachment-metadata'
import { hasAttachmentFilename } from '#/lib/security'
import type { Operation } from '#/tools/types'

export function expectedConversionContentType(
  output: Operation['output'],
  format: string | boolean | undefined,
): string {
  switch (output) {
    case 'pdf':
      return 'application/pdf'
    case 'zip':
      return 'application/zip'
    case 'json':
      return 'application/json'
    case 'text':
      return 'text/plain'
    case 'file':
      return 'application/octet-stream'
    case 'image':
      return `image/${format === 'jpeg' || format === 'webp' ? format : 'png'}`
  }
}

/** Route-specific response types independent of the number of source files. */
export function fixedRouteResponseTypes(
  operationId: string,
  format: string | boolean | undefined,
): readonly string[] | undefined {
  switch (operationId) {
    case 'extract-attachments':
      return ['*', 'application/zip']
    case 'extract-text':
      return [format === 'markdown' ? 'text/markdown' : 'text/plain', 'application/zip']
    case 'render-pages':
      return [format === 'jpeg' ? 'image/jpeg' : 'image/png', 'application/zip']
    case 'compose-pages':
      return ['application/pdf']
    case 'split':
      // Even interval splitting can yield just one PDF.
      return ['application/pdf', 'application/zip']
    default:
      return undefined
  }
}

/** Individual extracted attachments have arbitrary content types and must be named. */
export function isNamedAttachmentResponse(
  type: string | undefined,
  disposition: string | null,
): boolean {
  return (
    type !== undefined &&
    isAttachmentMimeType(type) &&
    !type.startsWith('*/') &&
    !type.endsWith('/*') &&
    /^attachment\s*;/i.test(disposition ?? '') &&
    hasAttachmentFilename(disposition)
  )
}
