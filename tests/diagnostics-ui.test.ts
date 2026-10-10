import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { ConnectionManager } from '#/components/connection-manager'
import { DiagnosticsDialog } from '#/components/diagnostics-dialog'
import { buttonVariants } from '#/components/ui/button'
import type { BrowserConnection } from '#/lib/connection-profiles'

const connection = { kind: 'server' as const, id: 'primary' }
const props = {
  connection,
  connectionName: 'Primary',
  onClose: vi.fn(),
}

describe('diagnostics visibility and entry points', () => {
  it('always provides a health probe, without requiring debug feature visibility', () => {
    const html = renderToStaticMarkup(
      createElement(DiagnosticsDialog, { ...props, showDebug: false }),
    )
    expect(html).toContain('HEAD /health')
    expect(html).toContain('Run health probe')
    expect(html).toContain('Selected instance:')
    expect(html).not.toContain('Read debug info')
    expect(html).not.toContain('Prometheus metrics')
    expect(html).not.toContain('debug output can expose')
  })

  it('shows optional debug and metrics actions without the redundant debug warning', () => {
    const html = renderToStaticMarkup(
      createElement(DiagnosticsDialog, { ...props, showDebug: true, onOpenMetrics: vi.fn() }),
    )
    expect(html).toContain('Run health probe')
    expect(html).toContain('Read debug info')
    expect(html).toContain('Prometheus metrics')
    expect(html).not.toContain('API_ENABLE_DEBUG_ROUTE')
  })
})

describe('higher-contrast connection controls', () => {
  const browsers: BrowserConnection[] = [
    { id: 'browser-default', name: 'Default', url: 'https://example.org', auth: 'none' },
  ]

  it('renders Test connection with a filled accent variant and Remove with a danger tint', () => {
    const html = renderToStaticMarkup(
      createElement(ConnectionManager, {
        browserProfiles: browsers,
        managedProfiles: [],
        selected: 'browser-default',
        onApply: vi.fn(),
        onUpsert: vi.fn(),
        onRemove: vi.fn(),
      }),
    )
    expect(html).toMatch(/bg-sky-100[^>]*>Test connection<\/button>/)
    expect(html).toMatch(/bg-rose-50[^>]*>Remove<\/button>/)
  })

  it('provides distinguishable light and dark styles for important secondary actions', () => {
    expect(buttonVariants({ variant: 'accent' })).toContain('bg-sky-100')
    expect(buttonVariants({ variant: 'accent' })).toContain('dark:bg-sky-950')
    expect(buttonVariants({ variant: 'outline' })).toContain('bg-slate-50')
    expect(buttonVariants({ variant: 'outline' })).toContain('dark:bg-slate-800')
  })
})
