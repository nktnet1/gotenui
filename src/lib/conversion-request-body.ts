import { multipartBody } from '#/lib/multipart-body'
import { OVERLAY_KINDS, overlayUploads, type PostProcessFiles } from '#/lib/pdf-post-processing'

/** Serialize the Gotenui API envelope. Validation remains at the call site
 * and proxy, so the integration tests can exercise the same wire format.
 */
export function conversionRequestBody(
  payload: unknown,
  files: readonly File[] = [],
  auxiliary: readonly File[] = [],
  postFiles: PostProcessFiles = {},
  stageFiles: readonly File[] = [],
  archives: readonly File[] = [],
): FormData | Blob {
  const form = new FormData()
  form.set('payload', JSON.stringify(payload))
  for (const file of files) form.append('files', file, file.name)
  for (const file of auxiliary) form.append('auxiliary', file, file.name)
  for (const file of stageFiles) form.append('stageFile', file, file.name)
  for (const file of archives) form.append('archives', file, file.name)
  for (const kind of OVERLAY_KINDS) {
    for (const file of overlayUploads(postFiles, kind)) form.append(kind, file, file.name)
  }
  for (const file of postFiles.embeds ?? []) form.append('embeds', file, file.name)
  if (postFiles.facturxXml)
    form.append('facturxXml', postFiles.facturxXml, postFiles.facturxXml.name)
  return multipartBody(form)
}
