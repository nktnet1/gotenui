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

/** Install dialog keyboard behaviour without depending on a particular modal component. */
export function activateModalFocus(
  dialog: HTMLElement,
  onClose: () => void,
  doc: Document = document,
): () => void {
  const previouslyFocused = doc.activeElement
  const releaseScrollLock = holdScrollLock(doc)

  const focusInside = () => (tabbableWithin(dialog)[0] ?? dialog).focus()
  focusInside()
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      onClose()
    } else {
      containTabFocus(event, dialog, doc.activeElement)
    }
  }
  const onFocusIn = (event: FocusEvent) => {
    if (!dialog.contains(event.target as Node)) focusInside()
  }
  doc.addEventListener('keydown', onKeyDown, true)
  doc.addEventListener('focusin', onFocusIn)
  return () => {
    doc.removeEventListener('keydown', onKeyDown, true)
    doc.removeEventListener('focusin', onFocusIn)
    releaseScrollLock()
    if (previouslyFocused?.isConnected && 'focus' in previouslyFocused) {
      ;(previouslyFocused as HTMLElement).focus()
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
