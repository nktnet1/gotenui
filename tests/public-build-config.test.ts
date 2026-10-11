import assert from 'node:assert/strict'
import { afterEach, describe, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe('PUBLIC_ browser build configuration', () => {
  it('uses the demo when no custom Gotenberg URL is supplied', async () => {
    vi.stubEnv('PUBLIC_GOTENBERG_DEFAULT_URL', undefined)
    vi.resetModules()
    const { DEFAULT_BACKEND_URL } = await import('#/lib/config')
    assert.equal(DEFAULT_BACKEND_URL, 'https://demo.gotenberg.dev')
  })

  it('normalizes a configured public default URL', async () => {
    vi.stubEnv('PUBLIC_GOTENBERG_DEFAULT_URL', 'https://pdf.example.test/gotenberg/')
    vi.resetModules()
    const { DEFAULT_BACKEND_URL } = await import('#/lib/config')
    assert.equal(DEFAULT_BACKEND_URL, 'https://pdf.example.test/gotenberg')
  })

  it('reads the PUBLIC_ upload limit instead of the retired VITE_ variable', async () => {
    vi.stubEnv('PUBLIC_GOTENUI_MAX_UPLOAD_BYTES', '7300000')
    vi.stubEnv('VITE_GOTENUI_MAX_UPLOAD_BYTES', '6400000')
    vi.resetModules()
    const { MAX_UPLOAD_BYTES } = await import('#/lib/gotenberg-client')
    assert.equal(MAX_UPLOAD_BYTES, 7300000)
  })
})
