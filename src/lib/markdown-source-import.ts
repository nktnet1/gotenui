import { filenameKey } from '#/lib/file-names'
import { MAX_UPLOAD_BYTES } from '#/lib/gotenberg-client'
import { InputError, safeFilename } from '#/lib/validation'

/** Validate the whole selection before reading any file, then decode without data loss. */
export async function readMarkdownSources(
  files: readonly File[],
  existingNames: readonly string[],
  maxBytes = MAX_UPLOAD_BYTES,
): Promise<{ name: string; content: string }[]> {
  const seen = new Set(existingNames.map(filenameKey))
  let total = 0
  for (const file of files) {
    safeFilename(file.name)
    if (!/\.md$/i.test(file.name) || file.size > maxBytes) {
      throw new InputError(`Choose a .md file within the configured upload limit: ${file.name}`)
    }
    total += file.size
    if (total > maxBytes)
      throw new InputError('The selected Markdown files exceed the configured upload limit.')
    const key = filenameKey(file.name)
    if (seen.has(key)) throw new InputError(`Duplicate Markdown filename: ${file.name}`)
    seen.add(key)
  }
  const sources: { name: string; content: string }[] = []
  for (const file of files) {
    try {
      sources.push({
        name: file.name,
        content: new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer()),
      })
    } catch {
      throw new InputError(`Could not read the Markdown file as UTF-8 text: ${file.name}`)
    }
  }
  return sources
}
