import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChromeDevToolsPipe } from '../scripts/chrome-devtools.ts'

const pipes: ChromeDevToolsPipe[] = []

function createPipe() {
  const input = new PassThrough()
  const output = new PassThrough()
  const devtools = new ChromeDevToolsPipe(input, output)
  pipes.push(devtools)
  const sent: string[] = []
  input.on('data', (chunk: Buffer) => sent.push(chunk.toString('utf8')))
  return { devtools, output, sent }
}

afterEach(() => {
  for (const pipe of pipes.splice(0)) pipe.close()
  vi.useRealTimers()
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
