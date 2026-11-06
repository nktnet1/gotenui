import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'vitest'
import { inspectZipResult } from '#/lib/zip-result-manifest'
import { browserImageZip, samplePng } from '#scripts/browser-output-fixtures'

test('browser mock uses an actual PNG and a previewable two-image ZIP', async () => {
  assert.deepEqual([...samplePng.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10])
  const bytes = browserImageZip()
  assert.deepEqual([...bytes.subarray(0, 4)], [80, 75, 3, 4])
  const manifest = await inspectZipResult(new Blob([new Uint8Array(bytes)]))
  assert.equal(manifest.totalFiles, 2)
  assert.deepEqual(
    manifest.entries.map(({ name, kind, size }) => ({ name, kind, size })),
    [
      { name: 'page-1.png', kind: 'Image', size: samplePng.length },
      { name: 'page-2.png', kind: 'Image', size: samplePng.length },
    ],
  )
})

test('browser smoke covers direct and queued output names and opt-in PNG/ZIP previews', () => {
  // Keep the interaction checks in the actual Chrome script rather than a mock UI.
  const source = readFileSync(new URL('../scripts/smoke-browser.ts', import.meta.url), 'utf8')
  const section = source.split('// Exercise the actual React result and batch panels')[1]
  assert.ok(section, 'Missing browser-level output checks')
  for (const expected of [
    'direct PNG result preview and download name',
    'completed PNG batch offers an opt-in preview',
    'batch PNG preview loads its existing Blob URL',
    'direct ZIP result uses its actual output extension',
    'direct ZIP manifest lists the two rendered PNGs',
    'completed batch ZIP preview lists both images',
  ]) {
    assert.ok(section.includes(expected), `Missing browser check: ${expected}`)
  }
})
