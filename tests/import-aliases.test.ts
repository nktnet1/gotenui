import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'
import { normalizeBackendUrl } from '#/lib/backend-url'

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

test('Node package imports map #/ to src and #scripts/ to scripts', () => {
  expect(pkg.imports).toMatchObject({
    '#/*': './src/*',
    '#scripts/*': './scripts/*.ts',
  })
})

test('Vite and Vitest resolve source imports through tsconfig paths', () => {
  const tsconfig = JSON.parse(readFileSync(new URL('../tsconfig.json', import.meta.url), 'utf8'))
  expect(tsconfig.compilerOptions.paths).toMatchObject({
    '#/*': ['./src/*'],
    '#scripts/*': ['./scripts/*'],
  })
  for (const file of ['vite.config.ts', 'vitest.config.ts', 'vitest.integration.config.ts']) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
    expect(source).toMatch(/resolve:\s*\{\s*tsconfigPaths:\s*true\s*\}/)
    expect(source).not.toContain('sourceAliases')
  }
  expect(normalizeBackendUrl('https://demo.gotenberg.dev/')).toBe('https://demo.gotenberg.dev')
})

test('native Node 24 loads extensionless script aliases used by the Vite config', () => {
  const script = [
    "import { labelDynamicChunkGroups } from '#scripts/nitro-build-warnings'",
    "if (typeof labelDynamicChunkGroups !== 'function') throw new Error('Invalid script aliases')",
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
  expect(config).not.toMatch(/from ['"](?:\.{1,2}\/|#scripts\/)[^'"]+\.(?:ts|tsx)['"]/)
})
