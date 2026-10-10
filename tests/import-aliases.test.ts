import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'
import { normalizeBackendUrl } from '#/lib/backend-url'
import { sourceAliases } from '#scripts/aliases'

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

test('Node package imports map #/ to src and #scripts/ to scripts', () => {
  expect(pkg.imports).toMatchObject({
    '#/*': './src/*',
    '#scripts/*': './scripts/*.ts',
  })
})

test('Vite and Vitest share the same source alias', () => {
  expect(sourceAliases['#/']).toBe(fileURLToPath(new URL('../src/', import.meta.url)))
  expect(normalizeBackendUrl('https://demo.gotenberg.dev/')).toBe('https://demo.gotenberg.dev')
})

test('native Node 24 loads extensionless script aliases used by the Vite config', () => {
  const script = [
    "import { sourceAliases } from '#scripts/aliases'",
    "import { labelDynamicChunkGroups } from '#scripts/nitro-build-warnings'",
    "if (!sourceAliases['#/'] || typeof labelDynamicChunkGroups !== 'function') throw new Error('Invalid script aliases')",
  ].join('\n')

  expect(() =>
    execFileSync(process.execPath, ['--input-type=module', '--eval', script], {
      cwd: fileURLToPath(new URL('../', import.meta.url)),
      stdio: 'pipe',
    }),
  ).not.toThrow()
})

test('Vite config imports local helpers without a path extension', () => {
  const config = readFileSync(new URL('../vite.config.ts', import.meta.url), 'utf8')
  expect(config).toContain("from '#scripts/nitro-build-warnings'")
  expect(config).toContain("from '#scripts/aliases'")
  expect(config).not.toMatch(/from ['"](?:\.{1,2}\/|#scripts\/)[^'"]+\.(?:ts|tsx)['"]/)
})
