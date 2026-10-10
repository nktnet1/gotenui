import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { setTimeout as sleep } from 'node:timers/promises'
import { promisify, styleText } from 'node:util'
import type { TestProject } from 'vitest/node'

const exec = promisify(execFile)
const image = process.env.GOTENBERG_TEST_IMAGE || 'gotenberg/gotenberg:8.37.0'
const startupTimeoutMs = 120_000
const testUsername = 'gotenui-integration'
const testPassword = 'local-only-test-password'

// Only the integration suite starts Docker. Unit tests never use a Gotenberg server.
declare module 'vitest' {
  export interface ProvidedContext {
    gotenbergTestUrl: string
    gotenbergFixtureUrl: string
    gotenbergTestUsername: string
    gotenbergTestPassword: string
  }
}

async function docker(...args: string[]): Promise<string> {
  const { stdout } = await exec('docker', args, { timeout: 600_000, maxBuffer: 1024 * 1024 })
  return stdout.trim()
}

async function fixtureServer(): Promise<{ server: Server; url: string }> {
  const server = createServer((req, res) => {
    if (req.url === '/attachment') {
      res.writeHead(200, {
        'content-type': 'text/plain',
        'content-disposition': 'attachment; filename=remote.txt',
      })
      res.end('Local Gotenberg integration attachment')
      return
    }
    if (req.url !== '/fixture') {
      res.writeHead(404).end()
      return
    }
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
    })
    res.end(
      '<!doctype html><html><head><title>Local fixture</title></head><body><h1>Gotenui integration</h1><p>Rendered without internet access.</p></body></html>',
    )
  })
  // Bind externally only for the duration of the test, so Docker can reach the host gateway.
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '0.0.0.0', () => {
      server.off('error', reject)
      resolve()
    })
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Could not bind fixture HTTP port')
  return { server, url: `http://host.docker.internal:${address.port}/fixture` }
}

async function waitForHealth(baseUrl: string): Promise<void> {
  const deadline = Date.now() + startupTimeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/health`, {
        signal: AbortSignal.timeout(2_000),
        headers: {
          Authorization: `Basic ${Buffer.from(`${testUsername}:${testPassword}`).toString('base64')}`,
        },
      })
      if (response.ok && (await response.json()).status === 'up') return
    } catch {
      // Gotenberg boots Chromium and LibreOffice before becoming healthy.
    }
    await sleep(500)
  }
  throw new Error(
    `Local Gotenberg at ${baseUrl} did not become healthy within ${startupTimeoutMs / 1000}s.`,
  )
}

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const name = `gotenui-integration-${randomUUID().slice(0, 12)}`
  let fixture: Server | undefined
  let started = false
  const closeFixture = async () => {
    if (fixture) await new Promise<void>((resolve) => fixture?.close(() => resolve()))
  }
  const cleanup = async () => {
    if (started) {
      await docker('rm', '-f', name).catch(() => {})
      started = false
    }
    await closeFixture()
  }
  try {
    await docker('info', '--format', '{{.ServerVersion}}')
    const html = await fixtureServer()
    fixture = html.server
    // Docker assigns a free localhost port. Never contact the public demo from tests.
    await docker(
      'run',
      '--detach',
      '--rm',
      '--name',
      name,
      '--env',
      'API_ENABLE_BASIC_AUTH=true',
      '--env',
      'API_ENABLE_DEBUG_ROUTE=true',
      '--env',
      `GOTENBERG_API_BASIC_AUTH_USERNAME=${testUsername}`,
      '--env',
      `GOTENBERG_API_BASIC_AUTH_PASSWORD=${testPassword}`,
      '--add-host',
      'host.docker.internal:host-gateway',
      '--publish',
      '127.0.0.1::3000',
      image,
    )
    started = true
    const mapping = await docker('port', name, '3000/tcp')
    const port = mapping.match(/127\.0\.0\.1:(\d+)/)?.[1]
    if (!port) throw new Error(`Unexpected Docker port mapping: ${mapping}`)
    const url = `http://127.0.0.1:${port}`
    await waitForHealth(url)
    project.provide('gotenbergTestUrl', url)
    project.provide('gotenbergFixtureUrl', html.url)
    project.provide('gotenbergTestUsername', testUsername)
    project.provide('gotenbergTestPassword', testPassword)
    console.info(`Local ${styleText('cyan', 'Gotenberg')} ready on ${url} (${image})`)
    return cleanup
  } catch (error) {
    await cleanup()
    throw new Error(
      'Integration tests require a running Docker daemon and the full Gotenberg image. ' +
        (error instanceof Error ? error.message : String(error)),
      { cause: error },
    )
  }
}
