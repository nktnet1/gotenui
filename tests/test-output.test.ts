import assert from 'node:assert/strict'
import { PassThrough } from 'node:stream'
import { stripVTControlCharacters } from 'node:util'
import { test } from 'vitest'
import { prefixTestLines } from '#scripts/test-process'

function captureOutput(label: 'unit' | 'v8' | 'v9') {
  const source = new PassThrough()
  const destination = new PassThrough()
  let output = ''
  destination.on('data', (chunk: Buffer) => {
    output += chunk.toString('utf8')
  })
  prefixTestLines(source, destination, label)
  return {
    source,
    get output() {
      return stripVTControlCharacters(output)
    },
  }
}

test('labels complete lines without waiting for a child process to exit', () => {
  const output = captureOutput('v8')
  output.source.write('Docker: Pulling 30%\r')
  assert.equal(output.output, '[v8] Docker: Pulling 30%\n')
  output.source.write('Docker: Pulling 100%\r\nReady\n')
  assert.equal(output.output, '[v8] Docker: Pulling 30%\n[v8] Docker: Pulling 100%\n[v8] Ready\n')
  output.source.end()
})

test('preserves partial lines and multibyte output across chunks', async () => {
  const captured = captureOutput('v9')
  captured.source.write('Gotenberg ')
  assert.equal(captured.output, '')
  const symbol = Buffer.from('✓')
  captured.source.write(symbol.subarray(0, 1))
  captured.source.write(symbol.subarray(1))
  const ended = new Promise<void>((resolve) => captured.source.once('end', resolve))
  captured.source.end(' ready')
  await ended
  assert.equal(captured.output, '[v9] Gotenberg ✓ ready\n')
})

test('labels each stdout and stderr line without combining independent streams', () => {
  const stdout = captureOutput('unit')
  const stderr = captureOutput('unit')
  stdout.source.end(' RUN v5\n')
  stderr.source.end(' FAIL a test\n')
  assert.equal(stdout.output, '[unit]  RUN v5\n')
  assert.equal(stderr.output, '[unit]  FAIL a test\n')
})
