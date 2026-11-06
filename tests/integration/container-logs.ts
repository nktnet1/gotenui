import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
// The test container name uses randomUUID().slice(0, 12), including its first hyphen.
const containerPattern = /^gotenui-integration-[0-9a-f]{8}-[0-9a-f]{3}$/

async function dockerLogTail(name: string): Promise<string> {
  const { stdout, stderr } = await execFileAsync(
    'docker',
    ['logs', '--timestamps', '--tail', '100', name],
    { encoding: 'utf8', timeout: 5_000, maxBuffer: 256 * 1024 },
  )
  return `${stdout}\n${stderr}`
}

/** Collect bounded upstream diagnostics before the integration container is removed. */
export async function integrationContainerLogs(
  containerName: string,
  readLogs: (name: string) => Promise<string> = dockerLogTail,
): Promise<string> {
  if (!containerPattern.test(containerName))
    return 'Docker logs unavailable: invalid test container.'

  try {
    const output = await readLogs(containerName)
    const tail = output.trim().split(/\r?\n/).slice(-100).join('\n').slice(-8_000)
    return tail.replaceAll('local-only-test-password', '[redacted]') || 'No recent Docker logs.'
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return `Docker logs unavailable: ${detail.slice(0, 300)}`
  }
}
