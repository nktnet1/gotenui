import { describe, expect, it, vi } from 'vitest'
import { integrationContainerLogs } from './integration/container-logs'

const containerName = 'gotenui-integration-01234567-abc'

describe('Gotenberg integration failure diagnostics', () => {
  it('returns a bounded log tail and redacts local test credentials', async () => {
    const readLogs = vi
      .fn()
      .mockResolvedValue(
        `${Array.from({ length: 125 }, (_, index) => `line ${index}`).join('\n')}\nlocal-only-test-password`,
      )
    const message = await integrationContainerLogs(containerName, readLogs)
    expect(message).toContain('line 124')
    expect(message).not.toContain('line 0\n')
    expect(message).not.toContain('local-only-test-password')
    expect(message).toContain('[redacted]')
    expect(readLogs).toHaveBeenCalledExactlyOnceWith(containerName)
  })

  it('never invokes Docker for names outside the temporary integration namespace', async () => {
    const readLogs = vi.fn()
    expect(await integrationContainerLogs('another-container', readLogs)).toMatch(
      /invalid test container/,
    )
    expect(readLogs).not.toHaveBeenCalled()
  })

  it('preserves a useful message when Docker logs are empty or unavailable', async () => {
    expect(await integrationContainerLogs(containerName, async () => '')).toBe(
      'No recent Docker logs.',
    )
    expect(
      await integrationContainerLogs(containerName, async () => {
        throw new Error('Docker daemon disconnected')
      }),
    ).toContain('Docker daemon disconnected')
  })
})
