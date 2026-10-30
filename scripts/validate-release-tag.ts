import { appendFileSync, readFileSync } from 'node:fs'
import { styleText } from 'node:util'
import { readReleaseChangelog } from './release-notes.ts'
import { validateReleaseTag } from './release-version.ts'

try {
  const tag = process.argv[2] ?? process.env.GITHUB_REF_NAME
  if (!tag) throw new Error('Supply a release tag or set GITHUB_REF_NAME.')

  const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  if (typeof version !== 'string') throw new Error('Missing package.json version.')

  const result = validateReleaseTag(tag, version)
  readReleaseChangelog(tag)
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `prerelease=${result.prerelease}\n`)
  }
  console.log(
    `Validated release tag ${styleText('green', tag)} against package.json and its changelog.`,
  )
} catch (error) {
  console.error(`${styleText('red', 'Error')}: ${error instanceof Error ? error.message : error}`)
  process.exitCode = 1
}
