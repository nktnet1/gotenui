/**
 * The canonical tool catalogue. Add a tool's config import here to expose it in the
 * homepage, sidebar, search, API validation and dynamic TanStack Start route.
 * Keep the order stable: it controls the tool lists and featured defaults.
 */

import { operation as bookmarksRead } from '#/tools/bookmarks-read/config'
import { operation as bookmarksWrite } from '#/tools/bookmarks-write/config'
import { operation as embed } from '#/tools/embed/config'
import { operation as encrypt } from '#/tools/encrypt/config'
import { operation as facturX } from '#/tools/factur-x/config'
import { operation as flatten } from '#/tools/flatten/config'
import { operation as htmlPdf } from '#/tools/html-pdf/config'
import { operation as htmlShot } from '#/tools/html-shot/config'
import { operation as markdownPdf } from '#/tools/markdown-pdf/config'
import { operation as markdownShot } from '#/tools/markdown-shot/config'
import { operation as merge } from '#/tools/merge/config'
import { operation as metadataRead } from '#/tools/metadata-read/config'
import { operation as metadataWrite } from '#/tools/metadata-write/config'
import { operation as officePdf } from '#/tools/office-pdf/config'
import { operation as optimize } from '#/tools/optimize/config'
import { operation as pdfa } from '#/tools/pdfa/config'
import { operation as rotate } from '#/tools/rotate/config'
import { operation as split } from '#/tools/split/config'
import { operation as stamp } from '#/tools/stamp/config'
import type { Operation, OperationGroup } from '#/tools/types'
import { operation as urlPdf } from '#/tools/url-pdf/config'
import { operation as urlShot } from '#/tools/url-shot/config'
import { operation as watermark } from '#/tools/watermark/config'

export const OPERATIONS: readonly Operation[] = [
  urlPdf,
  htmlPdf,
  markdownPdf,
  officePdf,
  urlShot,
  htmlShot,
  markdownShot,
  merge,
  split,
  pdfa,
  optimize,
  rotate,
  flatten,
  encrypt,
  watermark,
  stamp,
  metadataRead,
  metadataWrite,
  bookmarksRead,
  bookmarksWrite,
  embed,
  facturX,
]

export const OPERATION_BY_ID = new Map(OPERATIONS.map((operation) => [operation.id, operation]))

export const GROUPS: readonly OperationGroup[] = ['Convert', 'Capture', 'PDF tools']

export function operationDefaults(operation: Operation): Record<string, string | boolean> {
  const defaults: Record<string, string | boolean> = {}
  for (const field of operation.fields) {
    if (field.defaultValue !== undefined) defaults[field.name] = field.defaultValue
  }
  return defaults
}

export { activeOperationFields, isFieldVisible } from '#/tools/shared/field-visibility'
export type {
  AuxiliaryUpload,
  FieldDefinition,
  FieldKind,
  InputKind,
  Operation,
  OperationGroup,
} from '#/tools/types'
