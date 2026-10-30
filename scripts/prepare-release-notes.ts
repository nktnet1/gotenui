import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { styleText } from 'node:util'
import { buildReleaseBody, readReleaseChangelog } from './release-notes.ts'

try {
  const tag = process.env.TAG
  const image = process.env.IMAGE
  const digest = process.env.DIGEST
  const directory = process.env.RUNNER_TEMP
  if (!tag || !image || !digest || !directory) {
    throw new Error('TAG, IMAGE, DIGEST and RUNNER_TEMP are required to prepare release notes.')
  }

  const path = join(directory, 'gotenui-release-notes.md')
  writeFileSync(path, buildReleaseBody(readReleaseChangelog(tag), image, digest))
  console.log(`Prepared ${styleText('green', tag)} release notes from changelogs/${tag}.md.`)
} catch (error) {
  console.error(`${styleText('red', 'Error')}: ${error instanceof Error ? error.message : error}`)
  process.exitCode = 1
}
