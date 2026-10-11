import { ArrowUpRight, Search, X } from 'lucide-react'
import { useEffect, useId, useMemo, useState } from 'react'
import { operationIcon } from '#/components/operation-icons'
import { useModalFocus } from '#/components/use-modal-focus'
import { nextSearchIndex, searchOperations } from '#/lib/operation-search'
import { GROUPS, type Operation } from '#/lib/operations'
import { cn } from '#/lib/utils'

type Props = {
  onSelect: (id: string) => void
  onClose: () => void
  unavailableReason?: (operation: Operation) => string | null
}

/** Zero-dependency command palette; keeps focus in the query and uses a listbox for arrow navigation. */
export function OperationSearchDialog({ onSelect, onClose, unavailableReason }: Props) {
  const [query, setQuery] = useState('')
  const [highlighted, setHighlighted] = useState(0)
  const id = useId()
  const dialogRef = useModalFocus(onClose)
  const results = useMemo(() => {
    const ranked = searchOperations(query)
    // Keep DOM/keyboard order identical to the visible grouped order.
    return GROUPS.flatMap((group) => ranked.filter((operation) => operation.group === group))
  }, [query])
  const selectableIndices = results.flatMap((operation, index) =>
    unavailableReason?.(operation) ? [] : [index],
  )
  const activeIndex = selectableIndices.includes(highlighted)
    ? highlighted
    : (selectableIndices[0] ?? -1)
  const activeResultId = results[activeIndex]?.id

  useEffect(() => {
    if (activeResultId) {
      document.getElementById(`${id}-result-${activeIndex}`)?.scrollIntoView?.({ block: 'nearest' })
    }
  }, [activeIndex, activeResultId, id])

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto overscroll-none bg-slate-950/70 px-3 pt-[10vh] pb-6 backdrop-blur-sm sm:px-6">
      <button
        type="button"
        aria-label="Close tool search"
        aria-hidden="true"
        tabIndex={-1}
        className="absolute inset-0 cursor-default"
        onClick={onClose}
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Search tools"
        tabIndex={-1}
        className="relative w-full max-w-[680px] overflow-hidden rounded-2xl border border-slate-200 bg-white text-slate-900 shadow-2xl shadow-slate-950/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
      >
        <div className="flex h-16 items-center gap-3 border-b border-slate-200 px-4 dark:border-slate-700 sm:px-5">
          <Search aria-hidden="true" className="size-5 shrink-0 text-sky-600 dark:text-sky-400" />
          <input
            type="search"
            role="combobox"
            aria-label="Search tools"
            aria-autocomplete="list"
            aria-expanded="true"
            aria-controls={`${id}-results`}
            aria-activedescendant={activeIndex >= 0 ? `${id}-result-${activeIndex}` : undefined}
            autoComplete="off"
            spellCheck={false}
            placeholder="Search tools by name or keyword..."
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setHighlighted(0)
            }}
            onKeyDown={(event) => {
              const next = nextSearchIndex(
                selectableIndices.indexOf(activeIndex),
                selectableIndices.length,
                event.key,
              )
              if (next !== null) {
                event.preventDefault()
                setHighlighted(selectableIndices[next] ?? 0)
              } else if (event.key === 'Enter' && activeIndex >= 0) {
                event.preventDefault()
                const operation = results[activeIndex]
                if (operation && !unavailableReason?.(operation)) onSelect(operation.id)
              }
            }}
            className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-slate-400 dark:placeholder:text-slate-500"
          />
          <button
            type="button"
            aria-label="Close search"
            onClick={onClose}
            className="flex size-8 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 dark:text-slate-400 dark:hover:bg-slate-800"
          >
            <X className="size-4" />
          </button>
        </div>
        <div aria-live="polite" className="sr-only">
          {query.trim() ? `${results.length} matching tools` : 'Popular tools'}
        </div>
        <div
          id={`${id}-results`}
          role="listbox"
          aria-label="Tool search results"
          className="nav-scroll max-h-[min(55vh,450px)] overflow-y-auto overscroll-none p-2 sm:p-3"
        >
          {results.length === 0 ? (
            <p className="px-4 py-12 text-center text-sm text-slate-500 dark:text-slate-400">
              No tools found. Try another keyword.
            </p>
          ) : (
            GROUPS.map((group) => {
              const operations = results.filter((operation) => operation.group === group)
              if (operations.length === 0) return null
              return (
                // A listbox's named group uses ARIA; a form fieldset would be misleading here.
                // biome-ignore lint/a11y/useSemanticElements: Listbox grouping is not a form fieldset.
                <div key={group} role="group" aria-label={group} className="mb-2 last:mb-0">
                  <p className="px-3 py-2 text-[11px] font-bold tracking-wide text-slate-500 uppercase dark:text-slate-400">
                    {query.trim() ? group : `Popular · ${group}`}
                  </p>
                  {operations.map((operation) => {
                    const index = results.indexOf(operation)
                    const Icon = operationIcon(operation.id)
                    const unavailable = unavailableReason?.(operation)
                    return (
                      <button
                        key={operation.id}
                        id={`${id}-result-${index}`}
                        type="button"
                        role="option"
                        disabled={Boolean(unavailable)}
                        title={unavailable ?? undefined}
                        aria-selected={index === activeIndex}
                        tabIndex={-1}
                        onMouseEnter={() => setHighlighted(index)}
                        onClick={() => onSelect(operation.id)}
                        className={cn(
                          'flex w-full cursor-pointer items-center gap-3 rounded-xl px-3 py-3 text-left outline-none transition-colors disabled:cursor-not-allowed disabled:opacity-45',
                          index === activeIndex
                            ? 'bg-sky-50 text-sky-950 dark:bg-sky-950/60 dark:text-sky-100'
                            : 'text-slate-800 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800',
                        )}
                      >
                        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-sky-700 dark:border-slate-700 dark:bg-slate-800 dark:text-sky-300">
                          <Icon aria-hidden="true" className="size-4" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold">
                            {operation.title}
                          </span>
                          <span className="block truncate text-xs text-slate-500 dark:text-slate-400">
                            {unavailable ?? operation.summary}
                          </span>
                        </span>
                        <ArrowUpRight
                          aria-hidden="true"
                          className="size-4 shrink-0 text-slate-400"
                        />
                      </button>
                    )
                  })}
                </div>
              )
            })
          )}
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-slate-200 px-5 py-3 text-[11px] text-slate-500 dark:border-slate-700 dark:text-slate-400">
          <span>
            <kbd className="font-semibold">↑ ↓</kbd> Navigate
          </span>
          <span>
            <kbd className="font-semibold">↵</kbd> Open
          </span>
          <span>
            <kbd className="font-semibold">Esc</kbd> Close
          </span>
        </div>
      </div>
    </div>
  )
}
