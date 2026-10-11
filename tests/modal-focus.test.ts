import { describe, expect, it, vi } from 'vitest'
import { activateModalFocus, containTabFocus, tabbableWithin } from '#/components/use-modal-focus'

type FakeElement = HTMLElement & { focus: ReturnType<typeof vi.fn> }

function control(
  options: { tabIndex?: number; visible?: boolean; disabled?: boolean; inert?: boolean } = {},
) {
  const element = {
    tabIndex: options.tabIndex ?? 0,
    getClientRects: () => (options.visible === false ? [] : [{}]),
    matches: (selector: string) => selector === ':disabled' && Boolean(options.disabled),
    closest: () => (options.inert ? {} : null),
    isConnected: true,
    focus: vi.fn(),
  }
  return element as unknown as FakeElement
}

function dialog(elements: FakeElement[]) {
  const parent = {
    querySelectorAll: () => elements,
    contains: (child: unknown) => elements.includes(child as FakeElement),
    focus: vi.fn(),
  }
  return parent as unknown as FakeElement
}

function tab(shiftKey = false) {
  return { key: 'Tab', shiftKey, preventDefault: vi.fn() }
}

describe('dialog keyboard accessibility', () => {
  it('ignores disabled, hidden, inert and negative-tabindex controls', () => {
    const first = control()
    const last = control()
    const parent = dialog([
      control({ tabIndex: -1 }),
      control({ disabled: true }),
      control({ visible: false }),
      control({ inert: true }),
      first,
      last,
    ])
    expect(tabbableWithin(parent)).toEqual([first, last])
  })

  it('wraps forward from the last control to the first', () => {
    const first = control()
    const last = control()
    const parent = dialog([first, last])
    const event = tab()
    containTabFocus(event, parent, last)
    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(first.focus).toHaveBeenCalledOnce()
  })

  it('wraps backward from the first control to the last', () => {
    const first = control()
    const last = control()
    const parent = dialog([first, last])
    const event = tab(true)
    containTabFocus(event, parent, first)
    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(last.focus).toHaveBeenCalledOnce()
  })

  it('does not interrupt ordinary Tab navigation between controls', () => {
    const first = control()
    const middle = control()
    const last = control()
    const parent = dialog([first, middle, last])
    const event = tab()
    containTabFocus(event, parent, middle)
    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(first.focus).not.toHaveBeenCalled()
    expect(last.focus).not.toHaveBeenCalled()
  })

  it('recaptures focus outside the tab order, in either direction', () => {
    const first = control()
    const last = control()
    const parent = dialog([first, last])
    containTabFocus(tab(), parent, control())
    containTabFocus(tab(true), parent, parent)
    expect(first.focus).toHaveBeenCalledOnce()
    expect(last.focus).toHaveBeenCalledOnce()
  })

  it('focuses the container when no enabled, visible controls remain', () => {
    const parent = dialog([control({ disabled: true })])
    const event = tab()
    containTabFocus(event, parent, null)
    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(parent.focus).toHaveBeenCalledOnce()
  })

  it('recalculates focus targets as the dialog content changes', () => {
    const first = control()
    const second = control()
    const elements = [first, second]
    const parent = dialog(elements)
    elements.push(control())
    const event = tab()
    containTabFocus(event, parent, elements[2] ?? null)
    expect(first.focus).toHaveBeenCalledOnce()
  })

  it('moves focus into the modal, handles Escape, and restores the invoking control', () => {
    const invokingControl = control()
    const close = control()
    const parent = dialog([close])
    const callbacks = new Map<string, (event: unknown) => void>()
    const doc = {
      activeElement: invokingControl,
      body: { style: { overflow: 'auto' } },
      addEventListener: vi.fn((name: string, fn: (event: unknown) => void) => {
        callbacks.set(name, fn)
      }),
      removeEventListener: vi.fn((name: string) => {
        callbacks.delete(name)
      }),
    }
    const onClose = vi.fn()
    const cleanup = activateModalFocus(parent, onClose, doc as unknown as Document)
    expect(close.focus).toHaveBeenCalledOnce()
    expect(doc.body.style.overflow).toBe('hidden')

    const escapeEvent = {
      key: 'Escape',
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    }
    callbacks.get('keydown')?.(escapeEvent)
    expect(onClose).toHaveBeenCalledOnce()
    expect(escapeEvent.preventDefault).toHaveBeenCalledOnce()
    expect(escapeEvent.stopPropagation).toHaveBeenCalledOnce()

    callbacks.get('focusin')?.({ target: invokingControl })
    expect(close.focus).toHaveBeenCalledTimes(2)
    cleanup()
    expect(doc.body.style.overflow).toBe('auto')
    expect(callbacks.size).toBe(0)
    expect(invokingControl.focus).toHaveBeenCalledOnce()
  })

  it('keeps body scroll locked during overlapping modal transitions', () => {
    const doc = {
      activeElement: control(),
      body: { style: { overflow: 'auto' } },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }
    const first = activateModalFocus(dialog([control()]), vi.fn(), doc as unknown as Document)
    const second = activateModalFocus(dialog([control()]), vi.fn(), doc as unknown as Document)
    first()
    expect(doc.body.style.overflow).toBe('hidden')
    second()
    expect(doc.body.style.overflow).toBe('auto')
  })

  it('does not restore focus to an element removed while the modal was open', () => {
    const invokingControl = control()
    const parent = dialog([control()])
    const doc = {
      activeElement: invokingControl,
      body: { style: { overflow: '' } },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }
    const cleanup = activateModalFocus(parent, vi.fn(), doc as unknown as Document)
    Object.assign(invokingControl, { isConnected: false })
    cleanup()
    expect(invokingControl.focus).not.toHaveBeenCalled()
  })
})
