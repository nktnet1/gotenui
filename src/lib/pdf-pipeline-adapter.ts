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
    acknowledgedRedaction: payload.fields.acknowledgedRedaction === true,
  })
  const form = new FormData()
  for (const file of legacy.getAll('files')) {
    if (!(file instanceof File)) throw new InputError('Expected an uploaded PDF.')
    form.append('files', file, file.name)
  }
  for (const asset of auxiliary) form.append('files', asset, asset.name)
  // Remote downloads use the upstream Content-Disposition filename. Archive
  // stage assets are checked against indexed ZIP names by the proxy.
  const remote = legacy.get('downloadFrom')
  if (typeof remote === 'string') form.set('downloadFrom', remote)
  for (const archive of archives) form.append('archives', archive, archive.name)
  form.set('stages', JSON.stringify(stages))
  return { path: '/forms/pdf/pipe', form }
}
