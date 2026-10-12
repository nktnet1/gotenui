import assert from 'node:assert/strict'
import { type ChildProcess, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { styleText } from 'node:util'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const entry = resolve(root, '.output/server/index.mjs')
const chromium = [
  process.env.GOTENUI_BROWSER_BIN,
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/opt/google/chrome/chrome',
].find((path) => path && existsSync(path))

type CdpReply = {
  id?: number
  result?: Record<string, unknown>
  error?: { message: string }
}

type PendingCommand = {
  resolve: (value: Record<string, unknown>) => void
  reject: (error: Error) => void
  timeout: ReturnType<typeof setTimeout>
}

class BrowserPage {
  private socket: WebSocket
  private id = 0
  private pending = new Map<number, PendingCommand>()

  constructor(socket: WebSocket) {
    this.socket = socket
    socket.addEventListener('message', (event) => {
      const response = JSON.parse(String(event.data)) as CdpReply
      if (response.id === undefined) return
      const waiter = this.pending.get(response.id)
      if (!waiter) return
      this.pending.delete(response.id)
      clearTimeout(waiter.timeout)
      if (response.error) waiter.reject(new Error(response.error.message))
      else waiter.resolve(response.result ?? {})
    })
    socket.addEventListener('close', () => {
      for (const waiter of this.pending.values()) {
        clearTimeout(waiter.timeout)
        waiter.reject(new Error('Chrome disconnected.'))
      }
      this.pending.clear()
    })
  }

  static async connect(url: string): Promise<BrowserPage> {
    const socket = new WebSocket(url)
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('Chrome DevTools connection timed out.')),
        8_000,
      )
      socket.addEventListener(
        'open',
        () => {
          clearTimeout(timeout)
          resolve()
        },
        { once: true },
      )
      socket.addEventListener(
        'error',
        () => {
          clearTimeout(timeout)
          reject(new Error('Chrome DevTools connection failed.'))
        },
        { once: true },
      )
    })
    return new BrowserPage(socket)
  }

  async command(
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> {
    const id = ++this.id
    return new Promise<Record<string, unknown>>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Chrome DevTools command timed out: ${method}`))
      }, 8_000)
      this.pending.set(id, { resolve, reject, timeout })
      try {
        this.socket.send(JSON.stringify({ id, method, params }))
      } catch (error) {
        clearTimeout(timeout)
        this.pending.delete(id)
        reject(error instanceof Error ? error : new Error('Cannot send to Chrome DevTools.'))
      }
    })
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
    this.socket.close()
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
  const debugPort = await unusedPort()
  const app = spawn(process.execPath, [entry], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(appPort),
      NITRO_PORT: String(appPort),
      NITRO_HOST: '127.0.0.1',
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
      `--remote-debugging-port=${debugPort}`,
      '--remote-debugging-address=127.0.0.1',
      '--remote-allow-origins=*',
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  )
  let chromeLogs = ''
  browser.stderr.on('data', (data: Buffer) => {
    chromeLogs = `${chromeLogs}${data.toString()}`.slice(-4_000)
  })
  let page: BrowserPage | undefined
  let checks = 0
  try {
    const origin = `http://127.0.0.1:${appPort}`
    await waitForEndpoint(`${origin}/`, app, () => logs)
    await waitForEndpoint(`http://127.0.0.1:${debugPort}/json/version`, browser, () => chromeLogs)
    const targets = (await fetch(`http://127.0.0.1:${debugPort}/json/list`).then((res) =>
      res.json(),
    )) as Array<{ type: string; webSocketDebuggerUrl: string }>
    const target = targets.find((item) => item.type === 'page')
    assert.ok(target, 'Chrome did not create a debugging target.')
    page = await BrowserPage.connect(target.webSocketDebuggerUrl)
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
    assert.equal(lightSidebar, 'rgb(255, 255, 255)', 'Light sidebar must be white.')
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

    console.log(
      `Browser smoke: ${styleText('green', 'PASS')} (${checks} checks, desktop and mobile Chromium)`,
    )
  } finally {
    page?.close()
    await terminate(browser)
    await terminate(app)
    await rm(temp, { recursive: true, force: true })
  }
}

run().catch((error) => {
  console.error(`Browser smoke: ${styleText('red', 'FAIL')}`)
  console.error(error)
  process.exitCode = 1
})
