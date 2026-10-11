import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { ConnectionManager } from '#/components/connection-manager'
import { DiagnosticsDialog, nextDiagnosticTab } from '#/components/diagnostics-dialog'
import { buttonVariants } from '#/components/ui/button'
import type { BrowserConnection } from '#/lib/connection-profiles'

const connection = { kind: 'server' as const, id: 'primary' }
const props = {
  connection,
  connectionName: 'Primary',
  onClose: vi.fn(),
}

function renderDiagnostics(showDebug: boolean, showMetrics: boolean): string {
  return renderToStaticMarkup(
    createElement(DiagnosticsDialog, { ...props, showDebug, showMetrics }),
  )
}

describe('diagnostics visibility and accessible tabs', () => {
  it('always provides a fixed-width health probe without debug or metrics', () => {
    const html = renderDiagnostics(false, false)
    expect(html).toContain('HEAD /health')
    expect(html).toMatch(/class="[^"]*w-48 shrink-0[^"]*"[^>]*>.*Run health probe<\/button>/)
    expect(html).toContain('Selected instance:')
    expect(html).not.toContain('role="tablist"')
    expect(html).not.toContain('Read debug info')
    expect(html).not.toContain('Read metrics')
    expect(html).not.toContain('debug output can expose')
  })

  it('places Debug and Prometheus in separate, labelled, mutually exclusive tabs', () => {
    const html = renderDiagnostics(true, true)
    expect(html).toContain('role="tablist"')
    expect(html).toContain('aria-label="Diagnostic outputs"')
    expect(html).toMatch(/role="tab"[^>]*tabindex="0"[^>]*aria-selected="true"/)
    expect(html).toMatch(/role="tab"[^>]*tabindex="-1"[^>]*aria-selected="false"/)
    expect(html).toContain('Read debug info')
    expect(html).toContain('Read metrics')
    expect(html).toContain('role="tabpanel"')
    expect(html).toMatch(/role="tabpanel"[^>]*hidden=""/)
    expect(html).not.toContain('API_ENABLE_DEBUG_ROUTE')
    expect(html).not.toContain('Need performance counters instead')
  })

  it('keeps a metrics-only deployment accessible without exposing debug controls', () => {
    const html = renderDiagnostics(false, true)
    expect(html).toContain('HEAD /health')
    expect(html).toContain('Read metrics')
    expect(html).toContain('aria-selected="true"')
    expect(html).not.toContain('Read debug info')
  })

  it('does not expose Prometheus when only debug visibility is enabled', () => {
    const html = renderDiagnostics(true, false)
    expect(html).toContain('Read debug info')
    expect(html).not.toContain('Read metrics')
    expect(html).not.toContain('Metrics may reveal')
  })

  it('supports arrow wrapping, Home, End, and leaves unrelated keys alone', () => {
    const both = ['debug', 'metrics'] as const
    expect(nextDiagnosticTab(both, 'debug', 'ArrowRight')).toBe('metrics')
    expect(nextDiagnosticTab(both, 'metrics', 'ArrowRight')).toBe('debug')
    expect(nextDiagnosticTab(both, 'debug', 'ArrowLeft')).toBe('metrics')
    expect(nextDiagnosticTab(both, 'metrics', 'ArrowLeft')).toBe('debug')
    expect(nextDiagnosticTab(both, 'metrics', 'Home')).toBe('debug')
    expect(nextDiagnosticTab(both, 'debug', 'End')).toBe('metrics')
    expect(nextDiagnosticTab(both, 'debug', 'Tab')).toBeNull()
    expect(nextDiagnosticTab([], 'debug', 'Home')).toBeNull()
    expect(nextDiagnosticTab(['metrics'], 'metrics', 'ArrowRight')).toBe('metrics')
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
