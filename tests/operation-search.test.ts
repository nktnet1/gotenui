import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { OperationSearchDialog } from '#/components/operation-search-dialog'
import { TooltipProvider } from '#/components/ui/tooltip'
import {
  isSearchShortcut,
  nextSearchIndex,
  searchOperations,
  visibleSearchOperations,
} from '#/lib/operation-search'
import { OPERATIONS } from '#/lib/operations'

describe('tool search', () => {
  it('shows featured tools before a query is entered', () => {
    expect(searchOperations('').map((operation) => operation.id)).toEqual(
      OPERATIONS.filter((operation) => operation.featured).map((operation) => operation.id),
    )
  })

  it.each([
    ['compress', 'optimize'],
    ['pptx', 'office-pdf'],
    ['word', 'office-pdf'],
    ['combine pdf', 'merge'],
    ['html screenshot', 'html-shot'],
    ['webpage', 'url-pdf'],
    ['accessibility pdf', 'pdfa'],
    ['invoice xml', 'factur-x'],
    ['attach files', 'embed'],
    ['edit bookmarks', 'bookmarks-write'],
    ['edit author metadata', 'metadata-write'],
  ])('finds %s by useful keywords', (query, expectedId) => {
    expect(searchOperations(query)[0]?.id).toBe(expectedId)
  })

  it('allows prefixes, requires every search word and ignores unmatched queries', () => {
    expect(searchOperations('comp')[0]?.id).toBe('optimize')
    expect(searchOperations('compr')[0]?.id).toBe('optimize')
    expect(searchOperations('compli')[0]?.id).toBe('pdfa')
    expect(searchOperations('compliance')[0]?.id).toBe('pdfa')
    expect(searchOperations('PPTX')).toEqual(searchOperations('pptx'))
    expect(searchOperations('word impossiblekeyword')).toEqual([])
    expect(searchOperations('zzzzzzz')).toEqual([])
  })

  it('keeps match relevance ahead of navigation categories', () => {
    expect(visibleSearchOperations('comp')[0]?.id).toBe('optimize')
    expect(visibleSearchOperations('compliance')[0]?.id).toBe('pdfa')
    expect(visibleSearchOperations('')).toEqual(
      ['Convert', 'Capture', 'PDF tools'].flatMap((group) =>
        OPERATIONS.filter((operation) => operation.featured && operation.group === group),
      ),
    )
    expect(visibleSearchOperations('zzzzzzz')).toEqual([])
  })

  it('wraps arrow keys but leaves Home, End and editing keys available to the input', () => {
    expect(nextSearchIndex(0, 3, 'ArrowUp')).toBe(2)
    expect(nextSearchIndex(2, 3, 'ArrowDown')).toBe(0)
    expect(nextSearchIndex(0, 0, 'ArrowDown')).toBeNull()
    expect(nextSearchIndex(0, 3, 'Home')).toBeNull()
    expect(nextSearchIndex(0, 3, 'End')).toBeNull()
    expect(nextSearchIndex(0, 3, 'Backspace')).toBeNull()
  })

  it('uses Ctrl+K and Cmd+K without hijacking other key combinations', () => {
    const shortcut = { key: 'k', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false }
    expect(isSearchShortcut({ ...shortcut, ctrlKey: true })).toBe(true)
    expect(isSearchShortcut({ ...shortcut, metaKey: true, key: 'K' })).toBe(true)
    expect(isSearchShortcut({ ...shortcut, ctrlKey: true, shiftKey: true })).toBe(false)
    expect(isSearchShortcut({ ...shortcut, ctrlKey: true, key: 'j' })).toBe(false)
  })

  it('renders a modal combobox, accessible grouped results, and shortcut hints', () => {
    const html = renderToStaticMarkup(
      createElement(
        TooltipProvider,
        null,
        createElement(OperationSearchDialog, { onSelect: vi.fn(), onClose: vi.fn() }),
      ),
    )
    expect(html).toContain('role="dialog"')
    expect(html).toContain('aria-modal="true"')
    expect(html).toContain('role="combobox"')
    expect(html).toContain('aria-activedescendant=')
    expect(html).toContain('role="listbox"')
    expect(html).toContain('role="option"')
    expect(html).toContain('aria-selected="true"')
    expect(html).toContain('Popular · Convert')
    expect(html).toContain('Navigate')
    expect(html).toContain('Close')
  })
})
