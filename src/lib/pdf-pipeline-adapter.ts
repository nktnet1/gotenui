import { mergeUploadFilenames } from '#/lib/merge-order'
import { parsePdfPipeline, pdfStageAssetNames } from '#/lib/pdf-pipeline'
import { remoteStageAssets } from '#/lib/remote-stage-assets'
import { type ConversionPayload, InputError } from '#/lib/validation'

/** Convert the UI's ordered stages and named asset uploads to a v9 PDF request. */
export function adaptPdfPipeline(
  payload: ConversionPayload,
  legacy: FormData,
  auxiliary: readonly File[],
  archives: readonly File[] = [],
  archiveEntryNames: readonly string[] = [],
): { path: string; form: FormData } {
  if (payload.postProcess || Object.keys(payload.advanced).length) {
    throw new InputError(
      'The PDF pipeline uses its own stage settings; legacy advanced fields and post-processing are not supported.',
    )
  }
  if (payload.downloadFrom?.some((file) => file.field || file.embedded)) {
    throw new InputError(
      'The PDF pipeline accepts remote PDF inputs and named stage assets, not legacy remote destinations.',
    )
  }
  if (
    Object.keys(payload.fields).some((key) => !['stages', 'acknowledgedRedaction'].includes(key))
  ) {
    throw new InputError('The PDF pipeline contains unsupported form fields.')
  }
  const raw = payload.fields.stages
  if (typeof raw !== 'string') throw new InputError('Choose at least one PDF pipeline stage.')
  const references = pdfStageAssetNames(
    parsePdfPipeline(raw, {
      acknowledgedRedaction: payload.fields.acknowledgedRedaction === true,
    }),
  )
  const remoteNames = remoteStageAssets(payload.downloadFrom, references, [
    ...auxiliary.map(({ name }) => name),
    ...archiveEntryNames,
    ...legacy
      .getAll('files')
      .filter((file): file is File => file instanceof File)
      .map(({ name }) => name),
  ])
  const stages = parsePdfPipeline(raw, {
    assetNames: [...auxiliary.map(({ name }) => name), ...archiveEntryNames, ...remoteNames],
    allowUnresolvedAssets: payload.downloadFrom?.some(
      (remote) => !remote.filename && !remote.name && !remote.field && !remote.embedded,
    ),
    acknowledgedRedaction: payload.fields.acknowledgedRedaction === true,
  })
  const form = new FormData()
  const inputs = legacy.getAll('files')
  // Gotenberg 9 sorts PDFs by their received filenames, regardless of the
  // multipart upload order. Number local inputs when merging, as the standalone
  // merge tool does. A compose before the merge needs the original PDF names;
  // a compose after it instead refers to the merged document's new filename.
  const firstMerge = stages.findIndex(({ op }) => op === 'merge')
  const firstCompose = stages.findIndex(({ op }) => op === 'compose')
  const mergeBeforeCompose = firstMerge !== -1 && firstCompose > firstMerge
  const hasOtherPdfSources =
    archiveEntryNames.some((name) => /\.pdf$/i.test(name) && !references.includes(name)) ||
    (payload.downloadFrom ?? []).some(({ filename, name, field, embedded }) => {
      if (field || embedded) return false
      const actualName = filename ?? name
      return !actualName || (/\.pdf$/i.test(actualName) && !references.includes(actualName))
    })
  // A split before composition changes source filenames, and an external PDF
  // can become the first merged document. Do not rewrite such references from
  // guesses about what Gotenberg will name the resulting file.
  const canRenameForCompose =
    mergeBeforeCompose &&
    !stages.slice(0, firstCompose).some(({ op }) => op === 'split') &&
    !hasOtherPdfSources
  const orderedNames =
    firstMerge !== -1 && (firstCompose === -1 || canRenameForCompose) && inputs.length > 1
      ? mergeUploadFilenames(
          inputs.map((file) => (file instanceof File ? file.name : '')),
          [
            ...auxiliary.map(({ name }) => name),
            ...archiveEntryNames,
            ...(payload.downloadFrom ?? []).flatMap(({ filename, name }) =>
              filename || name ? [filename ?? name ?? ''] : [],
            ),
          ],
        )
      : []
  for (const [index, file] of inputs.entries()) {
    if (!(file instanceof File)) throw new InputError('Expected an uploaded PDF.')
    form.append('files', file, orderedNames[index] ?? file.name)
  }
  for (const asset of auxiliary) form.append('files', asset, asset.name)
  // Remote downloads use a v9.2 explicit filename or the upstream response's
  // Content-Disposition/URL filename. ZIP assets are checked by the proxy.
  const remote = legacy.get('downloadFrom')
  if (typeof remote === 'string') form.set('downloadFrom', remote)
  for (const archive of archives) form.append('archives', archive, archive.name)
  const firstSource = inputs[0]
  const firstName = firstSource instanceof File ? firstSource.name.normalize('NFC') : ''
  const mergedName = orderedNames[0]
  const mappedStages =
    canRenameForCompose && mergedName
      ? stages.map((stage, index) => {
          if (
            stage.op !== 'compose' ||
            index <= firstMerge ||
            stages.slice(firstMerge + 1, index).some(({ op }) => op === 'split') ||
            !Array.isArray(stage.placements)
          ) {
            return stage
          }
          return {
            ...stage,
            placements: stage.placements.map((placement) =>
              placement.source === firstName ? { ...placement, source: mergedName } : placement,
            ),
          }
        })
      : stages
  form.set('stages', JSON.stringify(mappedStages))
  return { path: '/forms/pdf/pipe', form }
}
