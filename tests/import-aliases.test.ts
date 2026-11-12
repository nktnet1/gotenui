import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'
import { normalizeBackendUrl } from '#/lib/backend-url'

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

test('Node package imports map #/ to src and #scripts/ to scripts', () => {
  expect(pkg.imports).toMatchObject({
    '#/lib/*': './src/lib/*.ts',
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

test('native Node resolves extensionless source and script subpaths, including both test runners', () => {
  const script = [
    "import { labelDynamicChunkGroups } from '#scripts/nitro-build-warnings'",
    "import { runTestSuites } from '#scripts/run-tests'",
    "import { integrationVersions } from '#scripts/run-integration-tests'",
    "import { vercelCommitSha } from '#/lib/app-version'",
    "if ([labelDynamicChunkGroups, runTestSuites, integrationVersions, vercelCommitSha].some((value) => typeof value !== 'function')) throw new Error('Invalid Node import aliases')",
    "if (integrationVersions('9.4.1')[0] !== '9.4.1') throw new Error('Invalid integration version')",
  ].join('\n')

  expect(() =>
    execFileSync(process.execPath, ['--input-type=module', '--eval', script], {
      cwd: fileURLToPath(new URL('../', import.meta.url)),
      stdio: 'pipe',
    }),
  ).not.toThrow()
})

test('CLI scripts use extensionless package subpaths for their local imports', () => {
  const scriptsDirectory = new URL('../scripts/', import.meta.url)
  for (const filename of readdirSync(scriptsDirectory).filter((name) => name.endsWith('.ts'))) {
    const source = readFileSync(new URL(filename, scriptsDirectory), 'utf8')
    expect(source, filename).not.toMatch(/from ['"]\.{1,2}\//)
    expect(source, filename).not.toMatch(/from ['"](?:#scripts\/|#\/)[^'"]+\.(?:ts|tsx)['"]/)
  }
})

test('Vite config imports local helpers without a path extension', () => {
  const config = readFileSync(new URL('../vite.config.ts', import.meta.url), 'utf8')
  expect(config).toContain("from '#scripts/nitro-build-warnings'")
  expect(config).not.toMatch(/from ['"](?:\.{1,2}\/|#scripts\/|#\/)[^'"]+\.(?:ts|tsx)['"]/)
})
