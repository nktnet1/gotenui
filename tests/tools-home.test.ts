import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { ToolsHome } from '#/components/tools-home'
import { TooltipProvider } from '#/components/ui/tooltip'
import { GROUPS, OPERATIONS } from '#/lib/operations'

function renderHome(status: Parameters<typeof ToolsHome>[0]['status'] = null) {
  return renderToStaticMarkup(
    createElement(
      TooltipProvider,
      null,
      createElement(ToolsHome, { status, onSelect: vi.fn(), onSearch: vi.fn() }),
    ),
  )
}

describe('all tools home', () => {
  it('generates exactly one tool card per operation from the shared registry', () => {
    const html = renderHome()
    expect(html).toContain('All tools')
    expect(html).toContain(`${OPERATIONS.length} tools in ${GROUPS.length} categories`)
    expect(html.match(/data-slot="tool-card"/g)).toHaveLength(OPERATIONS.length)
    for (const operation of OPERATIONS) {
      expect(html).toContain(operation.title.replaceAll('&', '&amp;'))
      expect(html).toContain(operation.summary.replaceAll('&', '&amp;'))
    }
    for (const group of GROUPS) expect(html).toContain(`>${group}</h2>`)
    expect(html).toContain('Search tools')
    expect(html).toContain('dark:bg-slate-900')
  })

  it('uses the existing availability rules for disabled tools', () => {
    const html = renderHome({ online: true, version: '8.35.0', modules: [] })
    const tooltip = html.indexOf('Optimize PDFs requires Gotenberg 8.36 or newer.')
    expect(tooltip).toBeGreaterThan(0)
    expect(html.slice(tooltip, tooltip + 1300)).toContain('disabled=""')
    expect(html).toContain('aria-disabled="true"')
  })
})
