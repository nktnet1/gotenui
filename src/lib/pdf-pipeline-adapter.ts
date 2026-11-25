import { forwardedRemoteFilenames } from '#/lib/file-names'
import {
  mergeUploadFilenames,
  numbersPipelineInputs,
  remoteMergeFilenames,
} from '#/lib/merge-order'
import { reconcilePdfComposeSources } from '#/lib/pdf-compose-sources'
import {
  parsePdfPipeline,
  pdfStageAssetNames,
  validatePdfStageUploads,
  validatePipelineSourceUploads,
} from '#/lib/pdf-pipeline'
import { remoteStageAssets } from '#/lib/remote-stage-assets'
import { isV9SourceDocument } from '#/lib/source-documents'
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
  const stages = parsePdfPipeline(raw, {
    acknowledgedRedaction: payload.fields.acknowledgedRedaction === true,
  })
  const references = pdfStageAssetNames(stages)
  const form = new FormData()
  const inputs = legacy.getAll('files')
  // Gotenberg 9 sorts PDFs by their received filenames, regardless of the
  // multipart upload order. Number local inputs when merging, as the standalone
  // merge tool does. A compose before merge still needs original PDF names.
  const orderedNames = numbersPipelineInputs(stages, inputs.length)
    ? mergeUploadFilenames(
        inputs.map((file) => (file instanceof File ? file.name : '')),
        [
          ...remoteMergeFilenames(payload.downloadFrom),
          ...archiveEntryNames,
          ...auxiliary.map(({ name }) => name),
        ],
      )
    : []
  const primaryNames = inputs.map((file, index) => {
    if (!(file instanceof File)) throw new InputError('Expected an uploaded PDF.')
    return orderedNames[index] ?? file.name
  })
  const remoteFilenames = forwardedRemoteFilenames(legacy, payload.downloadFrom)
  validatePipelineSourceUploads(stages, primaryNames, remoteFilenames, archiveEntryNames)
  const remoteNames = remoteStageAssets(
    payload.downloadFrom,
    references,
    [...auxiliary.map(({ name }) => name), ...archiveEntryNames, ...primaryNames],
    remoteFilenames,
  )
  parsePdfPipeline(raw, {
    assetNames: [...auxiliary.map(({ name }) => name), ...archiveEntryNames, ...remoteNames],
    allowUnresolvedAssets: remoteFilenames.some((name) => !name),
    acknowledgedRedaction: payload.fields.acknowledgedRedaction === true,
  })
  validatePdfStageUploads(
    stages,
    auxiliary.map(({ name }) => name),
  )
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
  const assets = new Set(references)
  const isInput = (name: string): boolean => isV9SourceDocument('pdf', name, assets)
  const external = [...archiveEntryNames.filter(isInput)]
  const mappedStages = reconcilePdfComposeSources(stages, {
    inputs: [
      ...remoteFilenames
        .filter((name): name is string => name !== undefined && isInput(name))
        .map((name) => ({ original: name, forwarded: name })),
      ...inputs.map((source, index) => {
        if (!(source instanceof File)) throw new InputError('Expected an uploaded PDF.')
        return { original: source.name, forwarded: orderedNames[index] ?? source.name }
      }),
      ...external.map((name) => ({ original: name, forwarded: name })),
    ],
    unknownInputs: remoteFilenames.some((name) => !name),
    registrationOrderKnown: !archives.length || !inputs.length,
    mapBookmarks: true,
  })
  form.set('stages', JSON.stringify(mappedStages))
  return { path: '/forms/pdf/pipe', form }
}
