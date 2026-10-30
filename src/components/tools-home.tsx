import { ArrowUpRight, LayoutGrid, Search } from 'lucide-react'
import { operationIcon } from '#/components/operation-icons'
import { ButtonTooltip } from '#/components/ui/button-tooltip'
import type { ServerStatus } from '#/lib/gotenberg-client'
import { unavailableOperationReason } from '#/lib/operation-availability'
import { GROUPS, OPERATIONS } from '#/lib/operations'

/** The same operation registry powers the home page, sidebar, and command palette. */
export function ToolsHome({
  status,
  onSelect,
  onSearch,
}: {
  status: ServerStatus | null
  onSelect: (id: string) => void
  onSearch: () => void
}) {
  return (
    <div data-slot="tools-home">
      <div className="mb-9 flex flex-wrap items-end justify-between gap-5">
        <div>
          <p className="mb-2 text-xs font-bold tracking-widest text-sky-700 uppercase dark:text-sky-400">
            Gotenui workspace
          </p>
          <h1 className="text-3xl font-extrabold tracking-tight text-slate-950 dark:text-white sm:text-4xl">
            All tools
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600 dark:text-slate-400">
            Convert documents, capture web pages, and work with PDFs. Choose a tool to get started.
          </p>
        </div>
        <button
          type="button"
          onClick={onSearch}
          className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-xs font-semibold text-slate-700 transition-colors hover:border-sky-400 hover:text-sky-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-sky-500 dark:hover:text-sky-300"
        >
          <Search aria-hidden="true" className="size-4" />
          Search tools
          <kbd className="ml-2 rounded border border-slate-200 px-1.5 py-0.5 text-[10px] dark:border-slate-700">
            Ctrl K
          </kbd>
        </button>
      </div>
      <p className="mb-6 flex items-center gap-2 text-xs font-medium text-slate-500 dark:text-slate-400">
        <LayoutGrid aria-hidden="true" className="size-4" />
        {OPERATIONS.length} tools in {GROUPS.length} categories
      </p>
      {GROUPS.map((group) => {
        const operations = OPERATIONS.filter((operation) => operation.group === group)
        if (operations.length === 0) return null
        const headingId = `tools-${group.toLowerCase().replace(/\W+/g, '-')}`
        return (
          <section key={group} aria-labelledby={headingId} className="mb-10 last:mb-0">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2
                id={headingId}
                className="text-lg font-bold tracking-tight text-slate-900 dark:text-white"
              >
                {group}
              </h2>
              <span className="text-xs text-slate-500 dark:text-slate-400">
                {operations.length} {operations.length === 1 ? 'tool' : 'tools'}
              </span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {operations.map((operation) => {
                const Icon = operationIcon(operation.id)
                const unavailable = unavailableOperationReason(status, operation)
                return (
                  <ButtonTooltip
                    key={operation.id}
                    description={unavailable}
                    disabled={Boolean(unavailable)}
                    wrapperClassName="block h-full w-full"
                  >
                    <button
                      type="button"
                      data-slot="tool-card"
                      disabled={Boolean(unavailable)}
                      onClick={() => onSelect(operation.id)}
                      className="group flex h-full min-h-36 w-full cursor-pointer flex-col items-start rounded-xl border border-slate-200 bg-white p-5 text-left shadow-sm transition-colors hover:border-sky-300 hover:bg-sky-50/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-55 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-sky-700 dark:hover:bg-slate-800/70"
                    >
                      <span className="mb-4 flex w-full items-center justify-between gap-3">
                        <span className="flex size-10 items-center justify-center rounded-lg bg-sky-50 text-sky-700 dark:bg-sky-950/70 dark:text-sky-300">
                          <Icon aria-hidden="true" className="size-5" />
                        </span>
                        <ArrowUpRight
                          aria-hidden="true"
                          className="size-4 text-slate-400 transition-colors group-hover:text-sky-600 dark:group-hover:text-sky-300"
                        />
                      </span>
                      <span className="text-sm font-bold text-slate-900 dark:text-slate-100">
                        {operation.title}
                      </span>
                      <span className="mt-1.5 text-xs leading-5 text-slate-500 dark:text-slate-400">
                        {unavailable ?? operation.summary}
                      </span>
                    </button>
                  </ButtonTooltip>
                )
              })}
            </div>
          </section>
        )
      })}
    </div>
  )
}
