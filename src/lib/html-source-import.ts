import { InputError } from '#/lib/validation'

// ConversionPayload.source is limited to 300,000 UTF-16 code units.
export const MAX_HTML_SOURCE_BYTES = 300_000

/** Read imported HTML as editable text, never as an additional multipart upload. */
export async function readHtmlSource(file: File): Promise<string> {
  if (!/\.html?$/i.test(file.name) || file.size === 0 || file.size > MAX_HTML_SOURCE_BYTES) {
    throw new InputError('Choose a non-empty .html or .htm file up to 300 KB.')
  }
  let content: string
  try {
    content = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer())
  } catch {
    throw new InputError('Could not read the HTML file as UTF-8 text.')
  }
  if (!content.trim()) throw new InputError('The HTML file is empty.')
  if (content.length > MAX_HTML_SOURCE_BYTES) {
    throw new InputError('The imported HTML exceeds the source editor limit of 300,000 characters.')
  }
  return content
}
