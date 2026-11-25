import { filenameKey } from '#/lib/file-names'
import { OFFICE_V9_EXTENSION_SET } from '#/lib/office-formats'

export type SourceDocumentKind = 'pdf' | 'office'

/** Gotenberg selects source documents by extension, excluding files read by stages. */
export function isV9SourceDocument(
  kind: SourceDocumentKind,
  name: string,
  assets?: ReadonlySet<string>,
): boolean {
  if (assets?.has(filenameKey(name))) return false
  const extension = name.slice(name.lastIndexOf('.')).toLowerCase()
  return kind === 'pdf' ? extension === '.pdf' : OFFICE_V9_EXTENSION_SET.has(extension)
}

/** Undefined names represent downloads whose final filename is not yet known. */
export function sourceDocumentReason(
  kind: SourceDocumentKind,
  names: readonly (string | undefined)[],
  assets?: ReadonlySet<string>,
): string | null {
  return names.some((name) => name === undefined || isV9SourceDocument(kind, name, assets))
    ? null
    : `Upload at least one source ${kind === 'pdf' ? 'PDF' : 'Office document'} not reserved by a pipeline stage.`
}
