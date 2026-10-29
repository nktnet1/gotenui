import assert from 'node:assert/strict'
import { type ChildProcess, spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { Readable, Writable } from 'node:stream'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { styleText } from 'node:util'
import { ChromeDevToolsPipe } from './chrome-devtools.ts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const entry = resolve(root, '.output/server/index.mjs')
const { version: appVersion } = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
  version: string
}
const chromium = [
  process.env.GOTENUI_BROWSER_BIN,
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/opt/google/chrome/chrome',
].find((path) => path && existsSync(path))

class BrowserPage {
  private sessionId?: string
  private readonly devtools: ChromeDevToolsPipe

  private constructor(devtools: ChromeDevToolsPipe) {
    this.devtools = devtools
  }

  static async connect(browser: ChildProcess): Promise<BrowserPage> {
    const input = browser.stdio[3]
    const output = browser.stdio[4]
    assert.ok(input instanceof Writable && output instanceof Readable)
    const page = new BrowserPage(new ChromeDevToolsPipe(input, output))
    try {
      // Creating the target explicitly avoids racing Chrome's initial blank tab.
      const { targetId } = await page.command('Target.createTarget', { url: 'about:blank' }, 20_000)
      assert.ok(typeof targetId === 'string', 'Chrome did not create a debugging page target.')
      const { sessionId } = await page.command('Target.attachToTarget', {
        targetId,
        flatten: true,
      })
      assert.ok(typeof sessionId === 'string', 'Chrome did not attach to the page target.')
      page.sessionId = sessionId
      return page
    } catch (error) {
      page.close()
      throw error
    }
  }

  command(
    method: string,
    params: Record<string, unknown> = {},
    timeoutMs?: number,
  ): Promise<Record<string, unknown>> {
    return this.devtools.command(method, params, this.sessionId, timeoutMs)
  }

  async evaluate(expression: string): Promise<unknown> {
    const result = await this.command('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    })
    if (result.exceptionDetails) throw new Error(`Browser evaluation failed: ${expression}`)
    return (result.result as { value?: unknown } | undefined)?.value
  }

  async waitUntil(expression: string, description: string): Promise<void> {
    const deadline = Date.now() + 10_000
    while (Date.now() < deadline) {
      if (await this.evaluate(expression)) return
      await sleep(75)
    }
    throw new Error(`Browser check timed out: ${description}`)
  }

  async press(key: string, modifiers = 0): Promise<void> {
    const codes: Record<string, [string, number]> = {
      k: ['KeyK', 75],
      Escape: ['Escape', 27],
      Enter: ['Enter', 13],
      Tab: ['Tab', 9],
      ArrowDown: ['ArrowDown', 40],
      ArrowUp: ['ArrowUp', 38],
    }
    const [code, windowsVirtualKeyCode] = codes[key] ?? [key, 0]
    await this.command('Input.dispatchKeyEvent', {
      type: 'rawKeyDown',
      key,
      code,
      windowsVirtualKeyCode,
      modifiers,
    })
    await this.command('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key,
      code,
      windowsVirtualKeyCode,
      modifiers,
    })
  }

  async hover(selector: string): Promise<void> {
    const center = (await this.evaluate(`(() => {
      const rect = document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect()
      return rect ? { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 } : null
    })()`)) as { x: number; y: number } | null
    assert.ok(center, `Cannot hover missing element: ${selector}`)
    await this.command('Input.dispatchMouseEvent', { type: 'mouseMoved', ...center })
  }

  async resize(width: number, height = 850): Promise<void> {
    await this.command('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: width < 1024,
    })
    await sleep(120)
  }

  close() {
    this.devtools.close()
  }
}

async function unusedPort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  await new Promise<void>((resolve) => server.close(() => resolve()))
  return address.port
}

async function waitForEndpoint(
  url: string,
  child: ChildProcess,
  logs: () => string,
): Promise<void> {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`Process exited before opening ${url}: ${logs()}`)
    }
    try {
      const reply = await fetch(url, { signal: AbortSignal.timeout(1000) })
      if (reply.ok) return
    } catch {
      // Service has not bound its listener yet.
    }
    await sleep(100)
  }
  throw new Error(`Process did not open ${url}: ${logs()}`)
}

async function terminate(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()))
  child.kill('SIGTERM')
  await Promise.race([exited, sleep(2_000)])
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL')
    await Promise.race([exited, sleep(2_000)])
  }
}

async function run(): Promise<void> {
  assert.ok(existsSync(entry), 'Build Gotenui before running the browser smoke suite.')
  assert.ok(chromium, 'Chrome/Chromium not found. Set GOTENUI_BROWSER_BIN to its executable path.')
  const temp = await mkdtemp(resolve(tmpdir(), 'gotenui-browser-'))
  const appPort = await unusedPort()
  const app = spawn(process.execPath, [entry], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(appPort),
      NITRO_PORT: String(appPort),
      NITRO_HOST: '127.0.0.1',
      GOTENUI_SHOW_DEBUG: 'true',
      GOTENUI_SHOW_METRICS: 'true',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let logs = ''
  const log = (data: Buffer) => {
    logs = `${logs}${data.toString()}`.slice(-4_000)
  }
  app.stdout.on('data', log)
  app.stderr.on('data', log)
  const browser = spawn(
    chromium,
    [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-networking',
      `--user-data-dir=${temp}`,
      '--remote-debugging-pipe',
    ],
    { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] },
  )
  let chromeLogs = ''
  assert.ok(browser.stderr, 'Chrome did not expose its stderr pipe.')
  browser.stderr.on('data', (data: Buffer) => {
    chromeLogs = `${chromeLogs}${data.toString()}`.slice(-4_000)
  })
  let page: BrowserPage | undefined
  let checks = 0
  try {
    const origin = `http://127.0.0.1:${appPort}`
    await waitForEndpoint(`${origin}/`, app, () => logs)
    try {
      page = await BrowserPage.connect(browser)
    } catch (error) {
      throw new Error(`Chrome DevTools failed to start: ${chromeLogs || '(no stderr)'}`, {
        cause: error,
      })
    }
    await page.command('Page.enable')
    await page.command('Runtime.enable')
    await page.resize(1440)
    await page.command('Page.navigate', { url: origin })
    await page
      .waitUntil(
        "document.querySelector('h1')?.textContent?.includes('Website to PDF')",
        'workspace hydration',
      )
      .catch(async (error: unknown) => {
        if (await page?.evaluate("location.href === 'chrome-error://chromewebdata/'")) {
          throw new Error('Chrome cannot open the local app (check managed browser URL policies).')
        }
        throw error
      })
    checks++
    assert.equal(await page.evaluate('document.title'), 'Website to PDF · Gotenui')
    checks++

    assert.equal(
      await page.evaluate(
        `document.querySelector('#gotenui-navigation')?.textContent?.includes('v${appVersion}')`,
      ),
      true,
      'Sidebar must display the app release version.',
    )
    checks++

    const refreshButton = 'button[aria-label="Refresh service status"]'
    await page.waitUntil(
      `!document.querySelector('${refreshButton}')?.disabled`,
      'initial background status check',
    )
    assert.equal(
      await page.evaluate(`document.querySelector('${refreshButton}')?.hasAttribute('title')`),
      false,
      'Refresh must not use the native browser title tooltip.',
    )
    await page.hover(refreshButton)
    await page.waitUntil(
      `[...document.querySelectorAll('[data-slot="tooltip-content"]')].some(el => el.textContent.includes("Recheck the selected Gotenberg connection's health, version, and modules"))`,
      'shadcn refresh tooltip on hover',
    )
    await page.hover('button[aria-haspopup="menu"]')
    await page.waitUntil(
      `[...document.querySelectorAll('[data-slot="tooltip-content"]')].some(el => el.textContent.includes('Appearance: System'))`,
      'shadcn theme selector tooltip',
    )
    assert.equal(
      await page.evaluate(
        "document.querySelector('button[aria-haspopup=menu]')?.hasAttribute('title')",
      ),
      false,
      'Theme selector must not use native browser tooltips.',
    )

    const diagnosticsButton = 'button[aria-label="Open diagnostics"]'
    await page.hover(diagnosticsButton)
    await page.waitUntil(
      `[...document.querySelectorAll('[data-slot="tooltip-content"]')].some(el => el.textContent.includes("Check the selected Gotenberg instance's health and available diagnostics"))`,
      'shadcn diagnostics tooltip',
    )
    assert.equal(
      await page.evaluate(
        `document.querySelector(${JSON.stringify(diagnosticsButton)})?.hasAttribute('title')`,
      ),
      false,
      'Diagnostics must not use a native browser tooltip.',
    )
    checks++

    await page.evaluate(`document.querySelector(${JSON.stringify(diagnosticsButton)}).click()`)
    await page.waitUntil(
      "document.querySelector('#diagnostics-heading') !== null",
      'diagnostics dialog',
    )
    const rightAlignedDiagnosticAction = `(() => {
      const panel = [...document.querySelectorAll('[role="tabpanel"]')].find(el => !el.hidden)
      const button = panel?.querySelector('form button[type="submit"]')
      if (!panel || !button) return false
      const panelBounds = panel.getBoundingClientRect()
      const actionBounds = button.getBoundingClientRect()
      return actionBounds.left > panelBounds.left + panelBounds.width / 2 &&
        Math.abs(actionBounds.right - panelBounds.right) < 4
    })()`
    assert.equal(
      await page.evaluate(rightAlignedDiagnosticAction),
      true,
      'Read debug info should align with the right edge of its panel.',
    )
    checks++
    await page.evaluate(
      `[...document.querySelectorAll('[role="tab"]')].find(el => el.textContent.includes('Prometheus')).click()`,
    )
    await page.waitUntil(
      `document.querySelector('[role="tab"][aria-controls$="-metrics-panel"]')?.getAttribute('aria-selected') === 'true'`,
      'Prometheus tab activation',
    )
    assert.equal(
      await page.evaluate(rightAlignedDiagnosticAction),
      true,
      'Read metrics should align with the right edge of its panel.',
    )
    checks++
    await page.resize(375)
    const mobileDiagnosticAction = `(() => {
      const panel = [...document.querySelectorAll('[role="tabpanel"]')].find(el => !el.hidden)
      const button = panel?.querySelector('form button[type="submit"]')
      if (!panel || !button) return false
      const panelBounds = panel.getBoundingClientRect()
      const actionBounds = button.getBoundingClientRect()
      return Math.abs(actionBounds.width - panelBounds.width) < 4 &&
        Math.abs(actionBounds.right - panelBounds.right) < 4
    })()`
    assert.equal(
      await page.evaluate(mobileDiagnosticAction),
      true,
      'Diagnostic actions should span the panel on mobile.',
    )
    checks++
    await page.resize(1440)
    await page.evaluate("document.querySelector('[role=dialog] button[aria-label=Close]').click()")
    assert.equal(
      await page.evaluate("document.querySelectorAll('[data-sonner-toast]').length"),
      0,
      'Background status checks must not display notifications.',
    )
    checks++

    await page.evaluate(`(() => {
      const originalFetch = window.fetch.bind(window)
      window.__smokeStatus = { online: true, version: '8.37.0', modules: [] }
      window.fetch = (input, options) => String(input).startsWith('/api/gotenberg/status?')
        ? Promise.resolve(Response.json(window.__smokeStatus))
        : originalFetch(input, options)
    })()`)
    await page.evaluate(`document.querySelector('${refreshButton}').click()`)
    await page.waitUntil(
      "[...document.querySelectorAll('[data-sonner-toast][data-type=success]')].some(el => el.textContent.includes('Gotenberg status refreshed - service online.'))",
      'manual refresh success toast',
    )
    await page.waitUntil(
      `!document.querySelector('${refreshButton}')?.disabled`,
      'manual refresh completion',
    )
    checks++

    await page.evaluate(
      `window.__smokeStatus = { online: false, version: 'Unavailable', modules: [] }`,
    )
    await page.evaluate(`document.querySelector('${refreshButton}').click()`)
    await page.waitUntil(
      "[...document.querySelectorAll('[data-sonner-toast][data-type=error]')].some(el => el.textContent.includes('Gotenberg status refreshed - service unavailable.'))",
      'manual refresh unavailable toast',
    )
    checks++

    await page.waitUntil(
      `!document.querySelector('${refreshButton}')?.disabled`,
      'unavailable refresh completion',
    )
    await page.evaluate(`window.__smokeStatus = { online: true, version: '8.35.0', modules: [] }`)
    await page.evaluate(`document.querySelector('${refreshButton}').click()`)
    const unavailableTooltip =
      '#gotenui-navigation [data-slot="tooltip-trigger"][aria-label="Optimize PDFs requires Gotenberg 8.36 or newer."]'
    await page.waitUntil(
      `document.querySelector(${JSON.stringify(unavailableTooltip)})?.querySelector('button:disabled') !== null`,
      'disabled navigation tooltip trigger',
    )
    await page.evaluate(`document.querySelector(${JSON.stringify(unavailableTooltip)}).focus()`)
    await page.waitUntil(
      "[...document.querySelectorAll('[data-slot=tooltip-content]')].some(el => el.textContent.includes('Optimize PDFs requires Gotenberg 8.36 or newer.'))",
      'disabled operation tooltip on keyboard focus',
    )
    checks++

    await page.waitUntil(
      `!document.querySelector('${refreshButton}')?.disabled`,
      'old-version refresh completion',
    )
    await page.evaluate(`window.__smokeStatus = { online: true, version: '8.37.0', modules: [] }`)
    await page.evaluate(`document.querySelector('${refreshButton}').click()`)
    await page.waitUntil(
      `!document.querySelector('${refreshButton}')?.disabled && !document.querySelector(${JSON.stringify(unavailableTooltip)})`,
      'restored module availability',
    )

    assert.equal(
      await page.evaluate(
        "getComputedStyle(document.querySelector('[aria-haspopup=menu] span')).display !== 'none'",
      ),
      true,
      'Desktop theme must have a visible label.',
    )
    checks++

    await page.evaluate("document.querySelector('button[aria-haspopup=menu]').click()")
    await page.waitUntil("document.querySelector('[role=menu]') !== null", 'appearance menu')
    await page.evaluate(
      "[...document.querySelectorAll('[role=menuitemradio]')].find(el => el.textContent.includes('Light')).click()",
    )
    await page.waitUntil(
      "!document.documentElement.classList.contains('dark')",
      'light theme selection',
    )
    const sidebarBackground =
      "getComputedStyle(document.querySelector('#gotenui-navigation')).backgroundColor"
    const lightSidebar = await page.evaluate(sidebarBackground)
    await page.hover(refreshButton)
    await page.waitUntil(
      `[...document.querySelectorAll('[data-slot="tooltip-content"]')].some(el => el.textContent.includes("Recheck the selected Gotenberg connection's health, version, and modules"))`,
      'light theme refresh tooltip',
    )
    const tooltipColors = `(() => {
      const content = [...document.querySelectorAll('[data-slot="tooltip-content"]')].find(
        el => el.textContent.includes("Recheck the selected Gotenberg connection's health, version, and modules")
      )
      const contentStyle = getComputedStyle(content)
      return {
        background: contentStyle.backgroundColor,
        text: contentStyle.color,
        border: contentStyle.borderTopColor,
        arrow: getComputedStyle(content.querySelector('svg')).fill,
      }
    })()`
    assert.deepEqual(
      await page.evaluate(tooltipColors),
      {
        background: 'rgb(255, 255, 255)',
        text: 'rgb(51, 65, 85)',
        border: 'rgb(226, 232, 240)',
        arrow: 'rgb(255, 255, 255)',
      },
      'Tooltip should use a soft light surface, not an inverted dark background.',
    )
    checks++

    assert.equal(lightSidebar, 'rgb(255, 255, 255)', 'Light sidebar must be white.')
    const sourceEditorColors = `(() => {
      const editor = document.querySelector('#source-editor')
      if (!editor) return null
      const style = getComputedStyle(editor)
      return { background: style.backgroundColor, text: style.color }
    })()`
    for (const operationName of ['HTML to PDF', 'Markdown to PDF']) {
      await page.evaluate(
        `[...document.querySelectorAll('#gotenui-navigation nav button')].find(el => el.textContent.trim() === ${JSON.stringify(operationName)}).click()`,
      )
      await page.waitUntil(
        `document.querySelector('h1')?.textContent?.includes(${JSON.stringify(operationName)}) && !!document.querySelector('#source-editor')`,
        `${operationName} source editor in light mode`,
      )
      assert.deepEqual(
        await page.evaluate(sourceEditorColors),
        { background: 'rgb(255, 255, 255)', text: 'rgb(15, 23, 42)' },
        `${operationName} source should use the light textarea theme.`,
      )
      checks++
    }
    // Exercise real output rendering rather than testing only Tailwind class strings.
    await page.evaluate(`(() => {
      const originalFetch = window.fetch.bind(window)
      window.fetch = (input, init) => {
        if (String(input) === '/api/gotenberg/debug') {
          return Promise.resolve(Response.json({ enabled: true, requests: 2, name: 'example', empty: null }))
        }
        if (String(input) === '/api/gotenberg/metrics') {
          return Promise.resolve(new Response('# HELP demo_counter Example\\ndemo_counter 2\\n', {
            headers: {
              'content-type': 'text/plain',
              'x-gotenui-metrics': '1',
              'x-gotenui-metrics-source': 'legacy',
            },
          }))
        }
        return originalFetch(input, init)
      }
    })()`)
    const diagnosticOutputColors = `(() => {
      const panel = [...document.querySelectorAll('[role="tabpanel"]')].find(el => !el.hidden)
      const output = panel?.querySelector('pre')
      if (!output) return null
      const style = getComputedStyle(output)
      return {
        background: style.backgroundColor,
        text: style.color,
        border: style.borderTopColor,
      }
    })()`
    await page.evaluate(`document.querySelector(${JSON.stringify(diagnosticsButton)}).click()`)
    await page.waitUntil(
      "document.querySelector('#diagnostics-heading') !== null",
      'light diagnostics',
    )
    await page.evaluate(
      "document.querySelector('[role=tabpanel]:not([hidden]) button[type=submit]').click()",
    )
    await page.waitUntil(
      "document.querySelector('[data-slot=json-code-output]')?.textContent.includes('enabled')",
      'light debug JSON output',
    )
    const lightDebugColors = await page.evaluate(diagnosticOutputColors)
    assert.ok(lightDebugColors, 'Light debug JSON must render a visible code surface.')
    assert.equal(
      await page.evaluate("document.querySelector('[data-json-token=key]')?.textContent"),
      '"enabled"',
      'Debug JSON must highlight object keys.',
    )
    assert.equal(
      await page.evaluate("document.querySelector('[data-json-token=boolean]')?.textContent"),
      'true',
      'Debug JSON must highlight typed values.',
    )
    checks++
    await page.evaluate(
      "[...document.querySelectorAll('[role=tab]')].find(el => el.textContent.includes('Prometheus')).click()",
    )
    await page.evaluate(
      "document.querySelector('[role=tabpanel]:not([hidden]) button[type=submit]').click()",
    )
    await page.waitUntil(
      "document.querySelector('[role=tabpanel]:not([hidden]) pre')?.textContent.includes('demo_counter')",
      'light metrics output',
    )
    assert.deepEqual(await page.evaluate(diagnosticOutputColors), lightDebugColors)
    checks++
    await page.evaluate("document.querySelector('[role=dialog] button[aria-label=Close]').click()")

    await page.evaluate(`
      [...document.querySelectorAll('#gotenui-navigation button')]
        .find(el => el.textContent.trim() === 'Connection settings').click()
    `)
    await page.waitUntil(
      "document.querySelector('#connection-heading') !== null",
      'connection settings dialog',
    )
    assert.equal(
      await page.evaluate(`(() => {
        const footer = [...document.querySelectorAll('[role=dialog] form div')]
          .find(el => el.classList.contains('justify-end') && el.querySelector('button[type=submit]'))
        if (!footer) return false
        const actions = [...footer.querySelectorAll('button')]
        const primary = actions.at(-1)
        if (!primary || primary.type !== 'submit' || primary.textContent.trim() !== 'Save and use') {
          return false
        }
        return Math.abs(primary.getBoundingClientRect().right - footer.getBoundingClientRect().right) < 4
      })()`),
      true,
      'Connection settings actions should be right-aligned with Save and use last.',
    )
    checks++
    await page.evaluate(
      'document.querySelector(\'[role=dialog] button[aria-label="Close settings"]\').click()',
    )
    const sidebarText =
      "getComputedStyle(document.querySelector('#gotenui-navigation nav button:not([aria-current])')).color"
    const lightSidebarText = await page.evaluate(sidebarText)
    checks++

    await page.evaluate(
      'document.querySelector(\'aside button[aria-label="Search tools"]\').focus()',
    )
    await page.press('k', 2) // Ctrl+K
    await page.waitUntil(
      'document.querySelector(\'[role=dialog][aria-label="Search tools"]\') !== null',
      'Ctrl+K tool search',
    )
    assert.equal(await page.evaluate("document.activeElement?.getAttribute('role')"), 'combobox')
    checks++

    await page.command('Input.insertText', { text: 'comp' })
    await page.waitUntil(
      "document.querySelector('[role=option]')?.textContent?.includes('Optimize PDFs')",
      'relevance-ranked search',
    )
    assert.equal(
      await page.evaluate(
        "document.querySelector('[role=option]')?.textContent?.includes('Optimize PDFs')",
      ),
      true,
    )
    checks++
    await page.press('ArrowDown')
    await page.waitUntil(
      "document.querySelector('[role=combobox]')?.getAttribute('aria-activedescendant')?.endsWith('-result-1')",
      'keyboard highlight moves down',
    )
    await page.press('ArrowUp')
    await page.waitUntil(
      "document.querySelector('[role=combobox]')?.getAttribute('aria-activedescendant')?.endsWith('-result-0')",
      'keyboard highlight moves up',
    )
    checks++

    await page.press('Enter')
    await page.waitUntil(
      "document.querySelector('h1')?.textContent?.includes('Optimize PDFs')",
      'search selection',
    )
    await page.waitUntil("document.title === 'Optimize PDFs · Gotenui'", 'search tool title')
    checks++

    await page.evaluate("document.querySelector('button[aria-haspopup=menu]').click()")
    await page.waitUntil("document.querySelector('[role=menu]') !== null", 'appearance menu')
    await page.evaluate(
      "[...document.querySelectorAll('[role=menuitemradio]')].find(el => el.textContent.includes('Dark')).click()",
    )
    await page.waitUntil(
      "document.documentElement.classList.contains('dark')",
      'dark theme selection',
    )
    assert.equal(
      await page.evaluate(sidebarBackground),
      'rgb(12, 27, 44)',
      'Dark sidebar must use the original navy surface.',
    )
    assert.notEqual(
      await page.evaluate(sidebarText),
      lightSidebarText,
      'Sidebar navigation text must adapt to the selected theme.',
    )
    checks++

    await page.hover(refreshButton)
    await page.waitUntil(
      `[...document.querySelectorAll('[data-slot="tooltip-content"]')].some(el => el.textContent.includes("Recheck the selected Gotenberg connection's health, version, and modules"))`,
      'dark theme refresh tooltip',
    )
    assert.deepEqual(
      await page.evaluate(tooltipColors),
      {
        background: 'rgb(30, 41, 59)',
        text: 'rgb(226, 232, 240)',
        border: 'rgb(51, 65, 85)',
        arrow: 'rgb(30, 41, 59)',
      },
      'Tooltip should use a muted dark surface, not an inverted light background.',
    )
    checks++

    await page.evaluate(`document.querySelector(${JSON.stringify(diagnosticsButton)}).click()`)
    await page.waitUntil(
      "document.querySelector('#diagnostics-heading') !== null",
      'dark diagnostics',
    )
    await page.evaluate(
      "document.querySelector('[role=tabpanel]:not([hidden]) button[type=submit]').click()",
    )
    await page.waitUntil(
      "document.querySelector('[data-slot=json-code-output]')?.textContent.includes('enabled')",
      'dark debug JSON output',
    )
    const darkDebugColors = await page.evaluate(diagnosticOutputColors)
    assert.ok(darkDebugColors, 'Dark debug JSON must render a visible code surface.')
    assert.notDeepEqual(
      darkDebugColors,
      lightDebugColors,
      'Debug JSON colours must follow the theme.',
    )
    checks++
    await page.evaluate(
      "[...document.querySelectorAll('[role=tab]')].find(el => el.textContent.includes('Prometheus')).click()",
    )
    await page.evaluate(
      "document.querySelector('[role=tabpanel]:not([hidden]) button[type=submit]').click()",
    )
    await page.waitUntil(
      "document.querySelector('[role=tabpanel]:not([hidden]) pre')?.textContent.includes('demo_counter')",
      'dark metrics output',
    )
    assert.deepEqual(await page.evaluate(diagnosticOutputColors), darkDebugColors)
    checks++
    await page.evaluate("document.querySelector('[role=dialog] button[aria-label=Close]').click()")

    for (const operationName of ['HTML to PDF', 'Markdown to PDF']) {
      await page.evaluate(
        `[...document.querySelectorAll('#gotenui-navigation nav button')].find(el => el.textContent.trim() === ${JSON.stringify(operationName)}).click()`,
      )
      await page.waitUntil(
        `document.querySelector('h1')?.textContent?.includes(${JSON.stringify(operationName)}) && !!document.querySelector('#source-editor')`,
        `${operationName} source editor in dark mode`,
      )
      assert.deepEqual(
        await page.evaluate(sourceEditorColors),
        { background: 'rgb(15, 23, 42)', text: 'rgb(241, 245, 249)' },
        `${operationName} source should use the dark textarea theme.`,
      )
      checks++
    }

    for (const width of [1440, 768, 375, 320]) {
      await page.resize(width)
      const size = (await page.evaluate(
        '({width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth, body: document.body.scrollWidth})',
      )) as { width: number; scroll: number; body: number }
      assert.ok(
        size.scroll <= size.width + 1 && size.body <= size.width + 1,
        `Horizontal overflow at ${width}px: ${JSON.stringify(size)}`,
      )
      checks++
    }
    assert.equal(
      await page.evaluate(
        "getComputedStyle(document.querySelector('[aria-haspopup=menu] span')).display",
      ),
      'none',
      'Theme label must be compact on mobile.',
    )
    checks++

    await page.evaluate(
      'document.querySelector(\'button[aria-label="Open menu"]\').focus(); document.querySelector(\'button[aria-label="Open menu"]\').click()',
    )
    await page.waitUntil(
      'document.querySelector(\'[role=dialog][aria-label="Navigation menu"]\') !== null',
      'mobile navigation',
    )
    await page.waitUntil("document.body.style.overflow === 'hidden'", 'mobile scroll lock')
    await page.press('Escape')
    await page.waitUntil(
      'document.querySelector(\'[role=dialog][aria-label="Navigation menu"]\') === null',
      'closing mobile navigation',
    )
    await page.waitUntil(
      "document.activeElement?.getAttribute('aria-label') === 'Open menu'",
      'mobile focus restoration',
    )
    checks++

    await page.evaluate('document.querySelector(\'button[aria-label="Open menu"]\').click()')
    await page.waitUntil(
      'document.querySelector(\'[role=dialog][aria-label="Navigation menu"]\') !== null',
      'reopening mobile navigation',
    )
    await page.evaluate(
      'document.querySelector(\'aside button[aria-label="Search tools"]\').click()',
    )
    await page.waitUntil(
      'document.querySelector(\'[role=dialog][aria-label="Search tools"]\') !== null && document.querySelector(\'[role=dialog][aria-label="Navigation menu"]\') === null',
      'mobile search',
    )
    await page.press('Escape')
    await page.waitUntil(
      'document.querySelector(\'[role=dialog][aria-label="Search tools"]\') === null',
      'closing mobile search',
    )
    await page.waitUntil(
      "document.body.style.overflow === ''",
      'scroll unlock after closing search',
    )
    await page.waitUntil(
      "document.activeElement?.getAttribute('aria-label') === 'Search tools' && !!document.activeElement?.closest('header')",
      'restore focus to visible mobile search button',
    )
    checks++
  } finally {
    page?.close()
    await terminate(browser)
    await terminate(app)
    // Chromium helpers may still be writing to the profile after the parent exits.
    await rm(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }
  console.log(
    `Browser smoke: ${styleText('green', 'PASS')} (${checks} checks, desktop and mobile Chromium)`,
  )
}

run().catch((error) => {
  console.error(`Browser smoke: ${styleText('red', 'FAIL')}`)
  console.error(error)
  process.exitCode = 1
})
