import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  attachToChromePage,
  ChromeDevToolsPipe,
  isNavigationContextLost,
  navigateChromeHistory,
  waitForBrowserCondition,
} from '#scripts/chrome-devtools'

const pipes: ChromeDevToolsPipe[] = []

function createPipe() {
  const input = new PassThrough()
  const output = new PassThrough()
  const devtools = new ChromeDevToolsPipe(input, output)
  pipes.push(devtools)
  const sent: string[] = []
  input.on('data', (chunk: Buffer) => sent.push(chunk.toString('utf8')))
  return { devtools, input, output, sent }
}

afterEach(() => {
  for (const pipe of pipes.splice(0)) pipe.close()
  vi.useRealTimers()
})

describe('Chrome page bootstrap', () => {
  function mockChrome(targetInfos: unknown[]) {
    const { devtools, input, output } = createPipe()
    // The mock speaks the same NUL-delimited protocol as the real debugging pipe.
    const commands: { method: string; params: Record<string, unknown> }[] = []
    const responses: Record<string, Record<string, unknown>> = {
      'Browser.getVersion': { product: 'Chrome/144.0' },
      'Target.getTargets': { targetInfos },
      'Target.createTarget': { targetId: 'new-page' },
      'Target.attachToTarget': { sessionId: 'page-session' },
    }
    input.on('data', (chunk: Buffer) => {
      for (const raw of chunk.toString('utf8').split('\0').filter(Boolean)) {
        const request = JSON.parse(raw) as {
          id: number
          method: string
          params: Record<string, unknown>
        }
        commands.push(request)
        output.write(`${JSON.stringify({ id: request.id, result: responses[request.method] })}\0`)
      }
    })
    return { devtools, commands }
  }

  it('attaches to the initial Chrome page without creating another renderer', async () => {
    const chrome = mockChrome([{ type: 'page', targetId: 'existing-page', attached: false }])
    await expect(attachToChromePage(chrome.devtools)).resolves.toBe('page-session')
    expect(chrome.commands.map(({ method }) => method)).toEqual([
      'Browser.getVersion',
      'Target.getTargets',
      'Target.attachToTarget',
    ])
    expect(chrome.commands[2]?.params).toEqual({ targetId: 'existing-page', flatten: true })
  })

  it('creates a page only when Chrome has no available page target', async () => {
    const chrome = mockChrome([{ type: 'service_worker', targetId: 'worker' }])
    await expect(attachToChromePage(chrome.devtools)).resolves.toBe('page-session')
    expect(chrome.commands.map(({ method }) => method)).toEqual([
      'Browser.getVersion',
      'Target.getTargets',
      'Target.createTarget',
      'Target.attachToTarget',
    ])
    expect(chrome.commands.at(-1)?.params).toEqual({ targetId: 'new-page', flatten: true })
  })
})

describe('Chrome DevTools pipe', () => {
  it('sends NUL-delimited commands and reassembles responses split across chunks', async () => {
    const { devtools, output, sent } = createPipe()
    const result = devtools.command('Target.createTarget', { url: 'about:blank' })
    expect(sent).toEqual([
      '{"id":1,"method":"Target.createTarget","params":{"url":"about:blank"}}\0',
    ])

    output.write('{"id":1,"result":{"target')
    output.write('Id":"abc"}}\0')
    await expect(result).resolves.toEqual({ targetId: 'abc' })
  })

  it('matches out-of-order replies, ignores events, and forwards session IDs', async () => {
    const { devtools, output, sent } = createPipe()
    const first = devtools.command('Runtime.evaluate', { expression: '2 + 2' }, 'session-1')
    const second = devtools.command('Page.enable')
    expect(JSON.parse(sent[0].slice(0, -1))).toEqual({
      id: 1,
      method: 'Runtime.evaluate',
      params: { expression: '2 + 2' },
      sessionId: 'session-1',
    })

    output.write('{"method":"Runtime.executionContextCreated","params":{}}\0')
    output.write('{"id":2,"result":{}}\0{"id":1,"result":{"result":{"value":4}}}\0')
    await expect(second).resolves.toEqual({})
    await expect(first).resolves.toEqual({ result: { value: 4 } })
  })

  it('rejects a CDP error without disconnecting other commands', async () => {
    const { devtools, output } = createPipe()
    const failed = devtools.command('Runtime.evaluate')
    const rejected = expect(failed).rejects.toThrow('Evaluation failed')
    output.write('{"id":1,"error":{"message":"Evaluation failed"}}\0')
    await rejected

    const next = devtools.command('Page.enable')
    output.write('{"id":2,"result":{}}\0')
    await expect(next).resolves.toEqual({})
  })

  it('rejects pending and subsequent commands on disconnect or invalid responses', async () => {
    const { devtools, output } = createPipe()
    const pending = devtools.command('Target.createTarget')
    const rejected = expect(pending).rejects.toThrow('invalid JSON')
    output.write('not-json\0')
    await rejected
    await expect(devtools.command('Page.enable')).rejects.toThrow('invalid JSON')

    const second = createPipe()
    const waiting = second.devtools.command('Page.enable')
    const disconnected = expect(waiting).rejects.toThrow('pipe closed')
    second.output.end()
    await disconnected
  })

  it('times out a command when Chrome never responds', async () => {
    vi.useFakeTimers()
    const { devtools } = createPipe()
    const pending = devtools.command('Target.createTarget', {}, undefined, 20)
    const rejection = expect(pending).rejects.toThrow('Chrome DevTools command timed out')
    await vi.advanceTimersByTimeAsync(20)
    await rejection
  })
})

describe('Browser smoke navigation safety', () => {
  it('uses the browser CDP history API for back and forward, never a self-invalidating evaluation', async () => {
    const { devtools, input, output, sent } = createPipe()
    const entries = [{ id: 10 }, { id: 20 }, { id: 30 }]
    let currentIndex = 1
    input.on('data', (chunk: Buffer) => {
      for (const raw of chunk.toString('utf8').split('\0').filter(Boolean)) {
        const request = JSON.parse(raw) as {
          id: number
          method: string
          params: { entryId?: number }
        }
        if (request.method === 'Page.navigateToHistoryEntry') {
          currentIndex = entries.findIndex(({ id }) => id === request.params.entryId)
        }
        const result =
          request.method === 'Page.getNavigationHistory' ? { entries, currentIndex } : {}
        output.write(`${JSON.stringify({ id: request.id, result })}\0`)
      }
    })

    await navigateChromeHistory(devtools, 'page-session', -1)
    await navigateChromeHistory(devtools, 'page-session', 1)
    const commands = sent.map((raw) => JSON.parse(raw.slice(0, -1))) as {
      method: string
      params: Record<string, unknown>
      sessionId: string
    }[]
    expect(commands.map(({ method }) => method)).toEqual([
      'Page.getNavigationHistory',
      'Page.navigateToHistoryEntry',
      'Page.getNavigationHistory',
      'Page.navigateToHistoryEntry',
    ])
    expect(commands.filter(({ method }) => method === 'Page.navigateToHistoryEntry')).toEqual([
      expect.objectContaining({ params: { entryId: 10 }, sessionId: 'page-session' }),
      expect.objectContaining({ params: { entryId: 20 }, sessionId: 'page-session' }),
    ])
  })

  it('rejects absent and malformed history entries instead of silently navigating elsewhere', async () => {
    for (const history of [
      { currentIndex: 0, entries: [{ id: 10 }] },
      { currentIndex: 1, entries: [{ id: 'invalid' }, { id: 20 }] },
      { currentIndex: 1, entries: [{ id: 10.5 }, { id: 20 }] },
      { currentIndex: '1', entries: [{ id: 10 }, { id: 20 }] },
    ]) {
      const { devtools, input, output, sent } = createPipe()
      input.on('data', (chunk: Buffer) => {
        const request = JSON.parse(chunk.toString('utf8').slice(0, -1)) as { id: number }
        output.write(`${JSON.stringify({ id: request.id, result: history })}\0`)
      })
      await expect(navigateChromeHistory(devtools, 'session', -1)).rejects.toThrow(
        'No Chrome history entry available to navigate back',
      )
      expect(sent).toHaveLength(1)
    }
  })

  it('reports the failed CDP method and error code without logging evaluated source', async () => {
    const { devtools, output } = createPipe()
    const failure = devtools.command('Runtime.evaluate', {
      expression: 'sensitive browser-only data',
    })
    const rejected = expect(failure).rejects.toThrow(
      'Chrome DevTools Runtime.evaluate failed (-32000): Inspected target navigated or closed',
    )
    output.write(
      `${JSON.stringify({ id: 1, error: { code: -32000, message: 'Inspected target navigated or closed' } })}\0`,
    )
    await rejected
    // A CDP error is raised asynchronously by the pipe, but its stack should
    // still lead back to the requesting test and command instead of receive().
    const another = devtools.command('Runtime.evaluate')
    const failed = another.catch((error: Error) => error)
    output.write(
      `${JSON.stringify({ id: 2, error: { code: -32000, message: 'Inspected target navigated or closed' } })}\0`,
    )
    const error = await failed
    expect(error.stack).toContain('tests/chrome-devtools.test.ts')
  })

  it('recognises only navigation-context interruptions as pollable errors', () => {
    for (const message of [
      'Chrome DevTools Runtime.evaluate failed (-32000): Inspected target navigated or closed',
      'Execution context was destroyed.',
      'Cannot find context with specified id',
    ]) {
      expect(isNavigationContextLost(new Error(message))).toBe(true)
    }
    expect(isNavigationContextLost(new Error('Navigation was blocked by URL policy'))).toBe(false)
    expect(isNavigationContextLost(new Error('Chrome DevTools pipe closed.'))).toBe(false)
    expect(isNavigationContextLost('Inspected target navigated or closed')).toBe(false)
  })

  it('retries navigation interruptions while polling, without masking unrelated errors', async () => {
    let attempts = 0
    await expect(
      waitForBrowserCondition(
        async () => {
          attempts++
          if (attempts === 1) throw new Error('Inspected target navigated or closed')
          return true
        },
        'page after reload',
        1_000,
        0,
      ),
    ).resolves.toBeUndefined()
    expect(attempts).toBe(2)

    attempts = 0
    const failure = new Error('Application assertion threw')
    await expect(
      waitForBrowserCondition(async () => {
        attempts++
        throw failure
      }, 'active tool'),
    ).rejects.toMatchObject({ message: 'Browser check failed: active tool', cause: failure })
    expect(attempts).toBe(1)
  })

  it('reports a failed navigation poll with the original error attached', async () => {
    const lost = new Error('Inspected target navigated or closed')
    await expect(
      waitForBrowserCondition(
        async () => {
          throw lost
        },
        'after full reload',
        5,
        0,
      ),
    ).rejects.toMatchObject({
      message: 'Browser check timed out: after full reload',
      cause: lost,
    })
  })
})
