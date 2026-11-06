import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { test } from 'vitest'

/**
 * Execute the actual browser-smoke navigation expressions. In JavaScript a
 * newline before `[` does not terminate a call, which previously made the
 * second click access a property of `undefined` (the first click's result).
 */
test('browser smoke opens the v9 pipeline and settings with independent navigation actions', () => {
  const source = readFileSync(new URL('../scripts/smoke-browser.ts', import.meta.url), 'utf8')
  const section = source.split('// Keep a v9-only tool selected while changing to v8.')[1]
  assert.ok(section)
  const expressions = [...section.matchAll(/await page\.evaluate\(`([\s\S]*?)`\)/g)]
    .slice(0, 2)
    .map((match) => match[1])
  assert.equal(expressions.length, 2, 'Each navigation action needs its own browser evaluation')

  const clicked: string[] = []
  const pipeline = {
    textContent: 'PDF pipeline builder',
    disabled: false,
    click: () => clicked.push('pipeline'),
  }
  const settings = {
    textContent: 'Connection settings',
    click: () => clicked.push('settings'),
  }
  const document = {
    querySelector: (selector: string) =>
      selector === '#gotenui-navigation nav button[data-operation-id="pdf-pipeline"]'
        ? pipeline
        : null,
    querySelectorAll: (selector: string) => {
      if (selector === '#gotenui-navigation button') return [pipeline, settings]
      return []
    },
  }
  for (const expression of expressions) runInNewContext(expression, { document })
  assert.deepEqual(clicked, ['pipeline', 'settings'])
})

test('browser smoke queues an available v8 tool with independent navigation and batch clicks', () => {
  const source = readFileSync(new URL('../scripts/smoke-browser.ts', import.meta.url), 'utf8')
  const section = source
    .split('// The Diagnostics dialog and queued conversions must follow')[1]
    ?.split('// Exercise the actual React result and batch panels')[0]
  assert.ok(section, 'Connection-switch browser checks must be present')
  const scripts = [...section.matchAll(/await page\.evaluate\(`\(\(\) => \{([\s\S]*?)\}\)\(\)`\)/g)]
    .map((match) => match[0].slice('await page.evaluate(`'.length, -'`)'.length))
    .filter(
      (script) =>
        script.includes("textContent.trim() === 'HTML to PDF'") ||
        script.includes("textContent.trim() === 'Add to batch'"),
    )
  assert.equal(scripts.length, 2)
  const clicked: string[] = []
  const conversion = {
    textContent: 'HTML to PDF',
    disabled: false,
    click: () => clicked.push('HTML to PDF'),
  }
  const queue = {
    textContent: 'Add to batch',
    disabled: false,
    click: () => clicked.push('Add to batch'),
  }
  const document = {
    querySelectorAll: (selector: string) =>
      selector === '#gotenui-navigation nav button'
        ? [conversion]
        : selector === 'button'
          ? [queue]
          : [],
  }
  for (const script of scripts) runInNewContext(script, { document })
  assert.deepEqual(clicked, ['HTML to PDF', 'Add to batch'])
})

test('connection-switch smoke waits for the saved profile draft, not just the native select value', () => {
  const source = readFileSync(new URL('../scripts/smoke-browser.ts', import.meta.url), 'utf8')
  const cases = [
    {
      description: 'v8 connection draft and URL have updated',
      choice: 'browser-demo',
      expectedUrl: 'https://demo.gotenberg.dev',
      staleUrl: 'https://v9.example.test',
    },
    {
      description: 'saved v9 connection draft and URL have updated',
      choice: 'browser-v9',
      expectedUrl: 'https://v9.example.test',
      staleUrl: 'https://demo.gotenberg.dev',
    },
    {
      description: 'restore saved v8 profile draft and URL',
      choice: 'browser-demo',
      expectedUrl: 'https://demo.gotenberg.dev',
      staleUrl: 'https://v9.example.test',
    },
  ]

  for (const { description, choice, expectedUrl, staleUrl } of cases) {
    const suffix = `      '${description}',`
    const suffixIndex = source.indexOf(suffix)
    assert.ok(suffixIndex > 0, `Missing saved-profile assertion: ${description}`)
    const start = source.lastIndexOf('await page.waitUntil(', suffixIndex)
    const match = source.slice(start, suffixIndex).match(/`([\s\S]*?)`/)
    assert.ok(match, `Missing evaluated wait condition: ${description}`)
    const expression = match[1]
    const selected = { value: choice }
    const url = { value: staleUrl }
    const context = {
      document: {
        querySelector: (selector: string) =>
          selector === '#connection-choice'
            ? selected
            : selector === '#connection-url'
              ? url
              : null,
      },
      window: {
        __originalSmokeUrl: 'https://demo.gotenberg.dev',
        __v9SmokeProfile: 'browser-v9',
      },
    }
    assert.equal(runInNewContext(expression, context), false, `${description}: stale URL`)
    url.value = expectedUrl
    assert.equal(runInNewContext(expression, context), true, `${description}: committed URL`)
  }
})

test('browser smoke includes a safe diagnostic snapshot when version switching fails', () => {
  const source = readFileSync(new URL('../scripts/smoke-browser.ts', import.meta.url), 'utf8')
  const marker = 'const snapshot = await page.evaluate(`'
  const start = source.indexOf(marker)
  assert.ok(start > 0, 'The failing v8 switch must include a diagnostics snapshot')
  const expression = source.slice(start + marker.length).split('`)')[0]
  const result = runInNewContext(expression, {
    location: { pathname: '/tools/pdf-pipeline' },
    window: { __pendingV8Status: [] },
    document: {
      querySelector: (selector: string) =>
        selector === 'h1'
          ? { textContent: 'PDF pipeline builder' }
          : selector === '#gotenui-navigation nav button[data-operation-id="pdf-pipeline"]'
            ? { textContent: 'PDF pipeline builder N/A', disabled: true }
            : null,
      querySelectorAll: (_selector: string) => [{ textContent: 'Online · 8.40.0' }],
    },
  }) as Record<string, unknown>
  assert.equal(result.selectedPath, '/tools/pdf-pipeline')
  assert.equal(result.serviceStatus, 'Online · 8.40.0')
  assert.equal(result.pipelineDisabled, true)
  assert.equal(result.pipelineMarkedUnavailable, true)
  assert.ok(!JSON.stringify(result).includes('password'))
})

test('v8 browser assertion finds the disabled v9-only tool even when N/A is displayed', () => {
  const source = readFileSync(new URL('../scripts/smoke-browser.ts', import.meta.url), 'utf8')
  const end = source.indexOf("'selected v9-only tool remains unavailable after switching to v8'")
  assert.ok(end > 0)
  const start = source.lastIndexOf('await page.waitUntil(', end)
  const match = source.slice(start, end).match(/`([\s\S]*?)`/)
  assert.ok(match)
  const button = { textContent: 'PDF pipeline builder N/A', disabled: true }
  const sidebar = { textContent: 'Online · 8.40.0' }
  const context = {
    location: { pathname: '/tools/pdf-pipeline' },
    document: {
      querySelector: (selector: string) =>
        selector === '#gotenui-navigation'
          ? sidebar
          : selector === '#gotenui-navigation nav button[data-operation-id="pdf-pipeline"]'
            ? button
            : selector === 'h1'
              ? { textContent: 'PDF pipeline builder' }
              : null,
    },
  }
  assert.equal(runInNewContext(match[1], context), true)
  button.disabled = false
  assert.equal(runInNewContext(match[1], context), false, 'v9-only tools must be disabled')
  button.disabled = true
  sidebar.textContent = 'Online · 9.0.0'
  assert.equal(runInNewContext(match[1], context), false, 'must verify the selected v8 version')
})
