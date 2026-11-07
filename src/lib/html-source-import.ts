import { MAX_UPLOAD_BYTES } from '#/lib/gotenberg-client'
import { InputError } from '#/lib/validation'

// Use the configured upload budget rather than an unrelated 300 KB field cap.
export const MAX_HTML_SOURCE_BYTES = MAX_UPLOAD_BYTES

/** Read imported HTML as editable text, never as an additional multipart upload. */
export async function readHtmlSource(file: File): Promise<string> {
  if (!/\.html?$/i.test(file.name) || file.size === 0 || file.size > MAX_HTML_SOURCE_BYTES) {
    throw new InputError(
      'Choose a non-empty .html or .htm file within the configured upload limit.',
    )
  }
  let content: string
  try {
    content = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer())
  } catch {
    throw new InputError('Could not read the HTML file as UTF-8 text.')
  }
  if (!content.trim()) throw new InputError('The HTML file is empty.')
  if (content.length > MAX_HTML_SOURCE_BYTES) {
    throw new InputError('The imported HTML exceeds the configured upload limit.')
  }
  return content
}
