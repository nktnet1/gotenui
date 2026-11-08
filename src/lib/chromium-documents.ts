/** Chromium's Markdown endpoint treats all uploaded files as siblings in one directory. */
export const DEFAULT_MARKDOWN_NAME = 'document.md'

/** The order of toHTML calls is the order of the rendered Markdown sections. */
export function defaultMarkdownTemplate(names: readonly string[]): string {
  // Preserve the exact v1.0.19 template for the original one-source workflow.
  if (names.length === 1 && names[0] === DEFAULT_MARKDOWN_NAME) {
    return '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Markdown</title><style>body{font:16px/1.6 system-ui;margin:40px auto;max-width:820px;padding:0 24px}</style></head><body>{{ toHTML "document.md" }}</body></html>'
  }
  // Quote filenames as template string literals. Names may legitimately
  // contain quotes or punctuation; interpolating them raw breaks the action.
  const sections = names
    .map((name) => `    <section>{{ toHTML ${JSON.stringify(name.normalize('NFC'))} }}</section>`)
    .join('\n')
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>Markdown</title>
    <style>body{font:16px/1.6 system-ui;margin:40px auto;max-width:820px;padding:0 24px}</style>
  </head>
  <body>
${sections}
  </body>
</html>`
}

/** Literal toHTML references supported by the Gotenberg Markdown template contract. */
export function markdownTemplateReferences(template: string): string[] {
  const matches = template.matchAll(/{{-?\s*toHTML\s+("(?:\\.|[^"\\])*")\s*-?}}/g)
  return Array.from(matches, (match) => {
    try {
      return JSON.parse(match[1] as string) as string
    } catch {
      return ''
    }
  }).filter(Boolean)
}
