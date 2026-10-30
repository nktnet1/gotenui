import { readFileSync } from 'node:fs'
import { validateReleaseTag } from './release-version.ts'

/** Release notes are committed alongside the version they describe. */
export function validateReleaseChangelog(tag: string, markdown: string): string {
  validateReleaseTag(tag, tag.slice(1))
  const notes = markdown.trim()
  if (!notes) throw new Error(`Release changelog changelogs/${tag}.md is empty.`)
  // The file path identifies the version. Do not force a particular Markdown
  // heading or section layout on release notes maintained by a human.
  if (
    !notes.split(/\r?\n/).some((line) => {
      const content = line.trim()
      return !content.startsWith('#') && /[\p{L}\p{N}]/u.test(content)
    })
  ) {
    throw new Error(`Release changelog changelogs/${tag}.md must describe changes.`)
  }
  return notes
}

export function readReleaseChangelog(tag: string): string {
  validateReleaseTag(tag, tag.slice(1))
  let markdown: string
  try {
    markdown = readFileSync(new URL(`../changelogs/${tag}.md`, import.meta.url), 'utf8')
  } catch {
    throw new Error(`Missing changelogs/${tag}.md. Commit release notes before tagging.`)
  }
  return validateReleaseChangelog(tag, markdown)
}

/** Preserve the human-written changelog and append the immutable published image. */
export function buildReleaseBody(changelog: string, image: string, digest: string): string {
  if (!/^ghcr\.io\/[a-z0-9._/-]+$/.test(image)) {
    throw new Error('Invalid GHCR image reference.')
  }
  if (!/^sha256:[a-f0-9]{64}$/.test(digest)) {
    throw new Error('Invalid published image digest.')
  }
  if (!changelog.trim()) throw new Error('Release changelog is empty.')
  return `${changelog.trimEnd()}\n\n## Container image\n\n\`${image}@${digest}\`\n`
}
