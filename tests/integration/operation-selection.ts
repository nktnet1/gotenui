import { OPERATIONS, type Operation } from '#/lib/operations'
import { V9_PDF_IDS } from '#/tools/v9-pdf-config'

/** Smoke-test only tools available on the selected image; specialised v9 PDF tests run separately. */
export function integrationSmokeOperations(major: 8 | 9): Operation[] {
  return OPERATIONS.filter(
    (operation) =>
      !V9_PDF_IDS.has(operation.id) && (operation.supportedGotenbergMajors ?? [8]).includes(major),
  )
}
