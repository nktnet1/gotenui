import { mergeUploadFilenames } from '#/lib/merge-order'
import { reconcilePdfComposeSources } from '#/lib/pdf-compose-sources'
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
  // merge tool does. A compose before merge still needs original PDF names.
  const firstMerge = stages.findIndex(({ op }) => op === 'merge')
  const firstCompose = stages.findIndex(({ op }) => op === 'compose')
  const orderedNames =
    firstMerge !== -1 && (firstCompose === -1 || firstCompose > firstMerge) && inputs.length > 1
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
  const isInput = (name: string): boolean =>
    /\.pdf$/i.test(name) && !references.includes(name.normalize('NFC'))
  const external = [
    ...archiveEntryNames.filter(isInput),
    ...(payload.downloadFrom ?? []).flatMap(({ filename, name }) => {
      const remoteName = filename ?? name
      return remoteName && isInput(remoteName) ? [remoteName] : []
    }),
  ]
  const mappedStages = reconcilePdfComposeSources(stages, {
    inputs: [
      ...inputs.map((source, index) => {
        if (!(source instanceof File)) throw new InputError('Expected an uploaded PDF.')
        return { original: source.name, forwarded: orderedNames[index] ?? source.name }
      }),
      ...external.map((name) => ({ original: name, forwarded: name })),
    ],
    unknownInputs: (payload.downloadFrom ?? []).some(({ filename, name }) => !(filename ?? name)),
  })
  form.set('stages', JSON.stringify(mappedStages))
  return { path: '/forms/pdf/pipe', form }
}
