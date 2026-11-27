import { useEffect, useRef } from 'react'

const TABBABLE_SELECTOR =
  'a[href], area[href], button, input:not([type="hidden"]), select, textarea, summary, [tabindex], [contenteditable="true"]'

/** Only include elements that can actually receive keyboard focus. */
export function tabbableWithin(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(TABBABLE_SELECTOR)).filter(
    (element) =>
      element.tabIndex >= 0 &&
      element.getClientRects().length > 0 &&
      !element.matches(':disabled') &&
      !element.closest('[hidden], [inert], [aria-hidden="true"]'),
  )
}

/** Keep both Tab directions inside a dialog, including when its contents change. */
export function containTabFocus(
  event: Pick<KeyboardEvent, 'key' | 'shiftKey' | 'preventDefault'>,
  container: HTMLElement,
  focused: Element | null,
): void {
  if (event.key !== 'Tab') return
  const tabbable = tabbableWithin(container)
  if (tabbable.length === 0) {
    event.preventDefault()
    container.focus()
    return
  }
  const target = event.shiftKey ? tabbable.at(-1) : tabbable[0]
  if (
    !tabbable.includes(focused as HTMLElement) ||
    (event.shiftKey && focused === tabbable[0]) ||
    (!event.shiftKey && focused === tabbable.at(-1))
  ) {
    event.preventDefault()
    target?.focus()
  }
}

/** Multiple dialogs may overlap for one render while switching from the mobile drawer
 * to search. Keep the page locked until the final dialog has closed.
 */
const scrollLocks = new WeakMap<Document, { count: number; previous: string }>()

function holdScrollLock(doc: Document): () => void {
  let lock = scrollLocks.get(doc)
  if (!lock) {
    lock = { count: 0, previous: doc.body.style.overflow }
    scrollLocks.set(doc, lock)
    doc.body.style.overflow = 'hidden'
  }
  lock.count++
  return () => {
    if (!lock) return
    lock.count--
    if (lock.count === 0) {
      doc.body.style.overflow = lock.previous
      scrollLocks.delete(doc)
    }
  }
}

type ModalFocusEntry = {
  dialog: HTMLElement
  previouslyFocused: Element | null
  focusInside: () => void
}

const modalStacks = new WeakMap<Document, ModalFocusEntry[]>()

/** Install dialog keyboard behaviour without depending on a particular modal component. */
export function activateModalFocus(
  dialog: HTMLElement,
  onClose: () => void,
  doc: Document = document,
): () => void {
  const releaseScrollLock = holdScrollLock(doc)
  const focusInside = () => (tabbableWithin(dialog)[0] ?? dialog).focus()
  const entry = { dialog, previouslyFocused: doc.activeElement, focusInside }
  const stack = modalStacks.get(doc) ?? []
  modalStacks.set(doc, stack)
  // Suspend the previous focus trap before moving focus to the new dialog.
  stack.push(entry)
  const isTop = () => stack.at(-1) === entry
  focusInside()
  const onKeyDown = (event: KeyboardEvent) => {
    if (!isTop()) return
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      onClose()
    } else {
      containTabFocus(event, dialog, doc.activeElement)
    }
  }
  const onFocusIn = (event: FocusEvent) => {
    if (isTop() && !dialog.contains(event.target as Node)) focusInside()
  }
  doc.addEventListener('keydown', onKeyDown, true)
  doc.addEventListener('focusin', onFocusIn, true)
  return () => {
    const index = stack.indexOf(entry)
    if (index === -1) return
    const wasTop = isTop()
    const next = stack[index + 1]
    if (next?.previouslyFocused && dialog.contains(next.previouslyFocused)) {
      // A lower dialog can disappear while the top dialog is still open.
      // Preserve its original return target instead of a removed control.
      next.previouslyFocused = entry.previouslyFocused
    }
    stack.splice(index, 1)
    doc.removeEventListener('keydown', onKeyDown, true)
    doc.removeEventListener('focusin', onFocusIn, true)
    releaseScrollLock()
    if (!stack.length) modalStacks.delete(doc)
    if (!wasTop) return
    const active = stack.at(-1)
    const previous = entry.previouslyFocused
    if (
      previous?.isConnected &&
      'focus' in previous &&
      (!active || active.dialog.contains(previous))
    ) {
      ;(previous as HTMLElement).focus()
    } else {
      active?.focusInside()
    }
  }
}

/** Focus on open, restore the invoking control on close, and trap keyboard focus. */
export function useModalFocus<T extends HTMLElement = HTMLDivElement>(
  onClose: () => void,
  active = true,
) {
  const ref = useRef<T>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    if (active && ref.current) {
      return activateModalFocus(ref.current, () => onCloseRef.current())
    }
  }, [active])

  return ref
}
