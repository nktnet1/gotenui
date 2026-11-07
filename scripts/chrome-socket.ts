import type { ChildProcess } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { PassThrough } from 'node:stream'
import { setTimeout as sleep } from 'node:timers/promises'
import { ChromeDevToolsPipe } from '#scripts/chrome-devtools'

/** Chrome's DevToolsActivePort contains a port and a browser WebSocket path. */
export function parseChromeActivePort(raw: string): string {
  const [port, path, ...rest] = raw.trim().split(/\r?\n/)
  if (
    rest.length ||
    !port ||
    !/^[1-9]\d{0,4}$/.test(port) ||
    Number(port) > 65535 ||
    !path ||
    !/^\/devtools\/browser\/[a-z0-9-]+$/i.test(path)
  ) {
    throw new Error('Chrome returned an invalid DevToolsActivePort file.')
  }
  return `ws://127.0.0.1:${port}${path}`
}

/** WebSocket fallback for Chrome builds that never answer --remote-debugging-pipe.
 * The bridge frames socket JSON as NUL-delimited CDP messages, so all existing
 * CDP history, evaluation, and timeout checks remain shared with the pipe.
 */
export async function connectChromeSocket(
  profile: string,
  browser: ChildProcess,
  timeoutMs = 20_000,
): Promise<{ devtools: ChromeDevToolsPipe; close: () => void }> {
  const deadline = Date.now() + timeoutMs
  let address: string | undefined
  while (Date.now() < deadline) {
    if (browser.exitCode !== null || browser.signalCode !== null) {
      throw new Error('Chrome exited before opening the DevTools WebSocket.')
    }
    try {
      address = parseChromeActivePort(
        await readFile(resolve(profile, 'DevToolsActivePort'), 'utf8'),
      )
      break
    } catch (error) {
      // Only ENOENT is a transient startup state; malformed port files and
      // unrelated file errors must not be silently retried.
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
    }
    await sleep(100)
  }
  if (!address) throw new Error('Chrome did not publish a DevTools WebSocket endpoint.')

  const socket = new WebSocket(address)
  await new Promise<void>((done, fail) => {
    const remaining = Math.max(1, deadline - Date.now())
    const timeout = setTimeout(
      () => fail(new Error('Chrome DevTools WebSocket startup timed out.')),
      remaining,
    )
    socket.addEventListener(
      'open',
      () => {
        clearTimeout(timeout)
        done()
      },
      { once: true },
    )
    socket.addEventListener(
      'error',
      () => {
        clearTimeout(timeout)
        fail(new Error('Could not connect to the Chrome DevTools WebSocket.'))
      },
      { once: true },
    )
  }).catch((error: unknown) => {
    socket.close()
    throw error
  })

  const input = new PassThrough()
  const output = new PassThrough()
  let pending = ''
  input.on('data', (chunk: Buffer) => {
    pending += chunk.toString('utf8')
    let end = pending.indexOf('\0')
    while (end >= 0) {
      const message = pending.slice(0, end)
      pending = pending.slice(end + 1)
      if (message && socket.readyState === WebSocket.OPEN) socket.send(message)
      end = pending.indexOf('\0')
    }
  })
  socket.addEventListener('message', (event) => {
    if (typeof event.data === 'string') output.write(`${event.data}\0`)
  })
  socket.addEventListener('close', () => output.end())
  socket.addEventListener('error', () =>
    output.destroy(new Error('Chrome DevTools WebSocket closed.')),
  )
  return {
    devtools: new ChromeDevToolsPipe(input, output),
    close: () => {
      if (socket.readyState !== WebSocket.CLOSED) socket.close()
    },
  }
}
