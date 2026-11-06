import { parsePdfPipeline } from '#/lib/pdf-pipeline'
import { type ConversionPayload, InputError } from '#/lib/validation'

/** Convert the UI's ordered stages and named asset uploads to a v9 PDF request. */
export function adaptPdfPipeline(
  payload: ConversionPayload,
  legacy: FormData,
  auxiliary: readonly File[],
): { path: string; form: FormData } {
  if (payload.postProcess || Object.keys(payload.advanced).length || payload.downloadFrom?.length) {
    throw new InputError(
      'The PDF pipeline uses local files and its own stage settings; legacy advanced fields, post-processing and remote inputs are not supported.',
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
    assetNames: auxiliary.map(({ name }) => name),
    acknowledgedRedaction: payload.fields.acknowledgedRedaction === true,
  })
  const form = new FormData()
  for (const file of legacy.getAll('files')) {
    if (!(file instanceof File)) throw new InputError('Expected an uploaded PDF.')
    form.append('files', file, file.name)
  }
  for (const asset of auxiliary) form.append('files', asset, asset.name)
  form.set('stages', JSON.stringify(stages))
  return { path: '/forms/pdf/pipe', form }
}
