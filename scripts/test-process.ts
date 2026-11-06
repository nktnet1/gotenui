import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import type { Readable, Writable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { styleText } from 'node:util'

export type TestLabel = 'unit' | 'v8' | 'v9' | 'v91'
export type TestProcessResult = {
  status: number | null
  signal?: NodeJS.Signals | null
  error?: Error
}

/** Prefix complete lines, including Docker's carriage-return progress updates. */
export function prefixTestLines(source: Readable, destination: Writable, label: TestLabel): void {
  const prefix = `${styleText('cyan', `[${label}]`)} `
  const reader = createInterface({ input: source, crlfDelay: Infinity, terminal: false })
  reader.on('line', (line) => {
    destination.write(`${prefix}${line}\n`)
  })
}

/** Give each suite its own Vitest process, version selection and labelled live output. */
export function spawnVitest(
  config: 'vitest.config.ts' | 'vitest.integration.config.ts',
  label: TestLabel,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<TestProcessResult> {
  const root = fileURLToPath(new URL('../', import.meta.url))
  const vitest = fileURLToPath(new URL('../node_modules/vitest/vitest.mjs', import.meta.url))
  return new Promise((resolve) => {
    let error: Error | undefined
    const child = spawn(process.execPath, [vitest, 'run', '--config', config], {
      cwd: root,
      env: environment,
      stdio: ['inherit', 'pipe', 'pipe'],
    })
    if (child.stdout) prefixTestLines(child.stdout, process.stdout, label)
    if (child.stderr) prefixTestLines(child.stderr, process.stderr, label)
    child.once('error', (cause) => {
      error = cause
    })
    child.once('close', (status, signal) => resolve({ status, signal, error }))
  })
}
