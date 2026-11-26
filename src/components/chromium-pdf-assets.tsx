import { useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import { Textarea } from '#/components/ui/textarea'
import { readHtmlSource } from '#/lib/html-source-import'
import { LatestFileImport } from '#/lib/latest-file-import'

type Props = {
  headerHtml: string
  footerHtml: string
  onHeaderChange: (value: string) => void
  onFooterChange: (value: string) => void
}

export function ChromiumPdfAssets({
  headerHtml,
  footerHtml,
  onHeaderChange,
  onFooterChange,
}: Props) {
  const headerImport = useRef(new LatestFileImport())
  const footerImport = useRef(new LatestFileImport())
  useEffect(
    () => () => {
      headerImport.current.cancel()
      footerImport.current.cancel()
    },
    [],
  )
  return (
    <section className="space-y-4 border-t border-slate-100 dark:border-slate-800 pt-5">
      <div>
        <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
          Custom PDF header and footer
        </h3>
        <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">
          Optional HTML fragments or full documents, sent as header.html and footer.html. Gotenberg
          renders them in a separate Chromium context: inline CSS and base64-encoded images only.
          External resources and JavaScript do not work. Allow enough top/bottom page margin to
          avoid clipping.
        </p>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {(
          [
            ['Header', headerHtml, onHeaderChange, headerImport.current],
            ['Footer', footerHtml, onFooterChange, footerImport.current],
          ] as const
        ).map(([label, html, onChange, importer]) => {
          const id = `pdf-${label.toLowerCase()}-html`
          return (
            <div key={label} className="space-y-2">
              <Label htmlFor={id}>{label} HTML (optional)</Label>
              <Textarea
                id={id}
                rows={7}
                spellCheck={false}
                value={html}
                placeholder={
                  '<html>\n<head><style>body { font-size: 11px }</style></head>\n<body>Page <span class="pageNumber"></span></body>\n</html>'
                }
                onChange={(event) => {
                  importer.cancel()
                  onChange(event.target.value)
                }}
                className="font-mono text-xs"
              />
              <Label htmlFor={`${id}-file`} className="text-xs text-slate-500 dark:text-slate-400">
                Or load {label.toLowerCase()} from an HTML file
              </Label>
              <Input
                id={`${id}-file`}
                type="file"
                accept=".html,.htm,text/html"
                className="h-auto py-2 text-xs file:mr-2"
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0]
                  event.currentTarget.value = ''
                  if (!file) return
                  void importer.run(
                    () => readHtmlSource(file),
                    onChange,
                    (error) =>
                      toast.error(
                        error instanceof Error
                          ? error.message
                          : `Could not read the ${label.toLowerCase()} file.`,
                      ),
                  )
                }}
              />
            </div>
          )
        })}
      </div>
    </section>
  )
}
