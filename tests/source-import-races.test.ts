import assert from 'node:assert/strict'
import { test, vi } from 'vitest'
import { LatestFileImport } from '#/lib/latest-file-import'
import { readMarkdownSources } from '#/lib/markdown-source-import'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

test('the most recent import wins even if an older file read finishes last', async () => {
  const importer = new LatestFileImport()
  const slow = deferred<string>()
  const publish = vi.fn()
  const failed = vi.fn()
  const pending = importer.run(() => slow.promise, publish, failed)
  await importer.run(async () => 'new', publish, failed)
  slow.resolve('old')
  await pending
  assert.deepEqual(publish.mock.calls, [['new']])
  assert.equal(failed.mock.calls.length, 0)
})

test('a manual edit or unmount invalidates both success and failure from a pending read', async () => {
  const importer = new LatestFileImport()
  const publish = vi.fn()
  const failed = vi.fn()
  const slow = deferred<string>()
  const pending = importer.run(() => slow.promise, publish, failed)
  importer.cancel()
  slow.resolve('old')
  await pending
  const failure = deferred<string>()
  const failing = importer.run(() => failure.promise, publish, failed)
  importer.cancel()
  failure.reject(new Error('stale failure'))
  await failing
  assert.equal(publish.mock.calls.length, 0)
  assert.equal(failed.mock.calls.length, 0)
  const error = new Error('current failure')
  await importer.run(
    async () => {
      throw error
    },
    publish,
    failed,
  )
  assert.deepEqual(failed.mock.calls, [[error]])
  await importer.run(async () => 'fresh', publish, failed)
  assert.deepEqual(publish.mock.calls, [['fresh']])
})

test('Markdown import preserves order, Unicode, whitespace and empty files', async () => {
  const files = [new File(['  # café\r\n'], 'café.md'), new File([], 'empty.MD')]
  assert.deepEqual(await readMarkdownSources(files, ['document.md'], 100), [
    { name: 'café.md', content: '  # café\r\n' },
    { name: 'empty.MD', content: '' },
  ])
})

test('Markdown imports reject invalid UTF-8 instead of silently inserting replacement characters', async () => {
  await assert.rejects(
    readMarkdownSources([new File([Uint8Array.of(0xff)], 'bad.md')], [], 100),
    /UTF-8/,
  )
})

test('Markdown selection validates duplicates and aggregate bytes before reading', async () => {
  const first = new File(['123'], 'café.md')
  const read = vi.spyOn(first, 'arrayBuffer')
  await assert.rejects(readMarkdownSources([first, new File(['456'], 'other.md')], [], 5), /exceed/)
  await assert.rejects(readMarkdownSources([first], ['cafe\u0301.md'], 5), /Duplicate/)
  await assert.rejects(
    readMarkdownSources([first, new File([], 'cafe\u0301.md')], [], 5),
    /Duplicate/,
  )
  await assert.rejects(
    readMarkdownSources([first, new File([], 'bad.html')], [], 5),
    /Choose a .md/,
  )
  await assert.rejects(readMarkdownSources([first], [], 2), /upload limit/)
  assert.equal(read.mock.calls.length, 0)
})
