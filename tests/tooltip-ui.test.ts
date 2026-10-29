import { readdirSync, readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ButtonTooltip } from '#/components/ui/button-tooltip'
import { TooltipProvider } from '#/components/ui/tooltip'

describe('shadcn tooltips', () => {
  it('uses a Radix tooltip trigger without a native title attribute', () => {
    const html = renderToStaticMarkup(
      createElement(
        TooltipProvider,
        null,
        createElement(
          ButtonTooltip,
          { description: 'Refresh the service status' },
          createElement('button', { type: 'button', 'aria-label': 'Refresh service status' }),
        ),
      ),
    )
    expect(html).toContain('data-slot="tooltip-trigger"')
    expect(html).toContain('aria-label="Refresh service status"')
    expect(html).not.toContain(' title=')
  })

  it('keeps disabled actions focusable for their tooltip, without enabling the action', () => {
    const html = renderToStaticMarkup(
      createElement(
        TooltipProvider,
        null,
        createElement(
          ButtonTooltip,
          { description: 'Module unavailable', disabled: true, wrapperClassName: 'block w-full' },
          createElement('button', { type: 'button', disabled: true }, 'Disabled tool'),
        ),
      ),
    )
    expect(html).toContain('data-slot="tooltip-trigger"')
    expect(html).toContain('role="button"')
    expect(html).toContain('aria-disabled="true"')
    expect(html).toContain('tabindex="0"')
    expect(html).toContain('class="inline-flex cursor-not-allowed')
    expect(html).toContain('block w-full')
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Disabled tool<\/button>/)
  })

  it('does not add a tooltip when there is nothing useful to explain', () => {
    const html = renderToStaticMarkup(
      createElement(
        TooltipProvider,
        null,
        createElement(
          ButtonTooltip,
          { description: null },
          createElement('button', { type: 'button' }, 'Available tool'),
        ),
      ),
    )
    expect(html).toContain('Available tool')
    expect(html).not.toContain('data-slot="tooltip-trigger"')
  })

  it('does not use native title tooltips in application components', () => {
    function findNativeTitles(dir: URL): string[] {
      return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        if (entry.isDirectory()) return findNativeTitles(new URL(`${entry.name}/`, dir))
        if (!entry.name.endsWith('.tsx')) return []
        const source = readFileSync(new URL(entry.name, dir), 'utf8')
        return source
          .split('\n')
          .flatMap((line, index) =>
            /^\s*title\s*=/.test(line) ? [`${entry.name}:${index + 1}`] : [],
          )
      })
    }
    expect(findNativeTitles(new URL('../src/', import.meta.url))).toEqual([])
  })
})
