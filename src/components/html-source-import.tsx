import { useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import { readHtmlSource } from '#/lib/html-source-import'

export function HtmlSourceImport({ onImport }: { onImport: (source: string) => void }) {
  const latestImport = useRef(0)
  useEffect(
    () => () => {
      // Discard a pending file read if the user switches operations.
      latestImport.current++
    },
    [],
  )
  return (
    <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50/60 p-3 dark:border-slate-700 dark:bg-slate-800/40">
      <Label htmlFor="html-source-import">Import HTML source</Label>
      <Input
        id="html-source-import"
        type="file"
        accept=".html,.htm,text/html"
        className="h-auto py-2 text-xs file:mr-2"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0]
          event.currentTarget.value = ''
          if (!file) return
          const request = ++latestImport.current
          void readHtmlSource(file)
            .then((text) => {
              if (request !== latestImport.current) return
              onImport(text)
              toast.success('HTML loaded into the source editor.')
            })
            .catch((error: unknown) => {
              if (request !== latestImport.current) return
              toast.error(error instanceof Error ? error.message : 'Could not import HTML.')
            })
        }}
      />
      <p className="text-xs leading-5 text-slate-500 dark:text-slate-400">
        Load a UTF-8 .html or .htm file (up to 300 KB). This replaces the current editor text, which
        Gotenberg receives as index.html. Optional assets remain separate.
      </p>
    </div>
  )
}
