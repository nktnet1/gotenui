import { ExternalLink, Eye, EyeOff } from 'lucide-react'
import { useId, useState } from 'react'
import { Button } from '#/components/ui/button'

/** Browser-local preview of a completed PDF. No server-side document storage or viewer API. */
export function PdfResultPreview({ url, name }: { url: string; name: string }) {
  const [visible, setVisible] = useState(false)
  const regionId = useId()
  return (
    <div className="mb-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          aria-expanded={visible}
          aria-controls={regionId}
          onClick={() => setVisible((current) => !current)}
        >
          {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          {visible ? 'Hide PDF preview' : 'Preview PDF'}
        </Button>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs font-semibold text-sky-700 hover:underline dark:text-sky-300"
        >
          <ExternalLink className="size-3.5" /> Open in new tab
        </a>
      </div>
      <div id={regionId} hidden={!visible}>
        {visible && (
          <div className="space-y-2">
            <PdfEmbeddedDocument url={url} name={name} />
            <p className="text-[11px] leading-5 text-slate-500 dark:text-slate-400">
              Preview uses your browser’s PDF viewer. If unavailable, download or open the PDF in a
              new tab.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

/** Embedded PDF fallback is browser-controlled and uses the existing in-memory URL. */
export function PdfEmbeddedDocument({ url, name }: { url: string; name: string }) {
  return (
    <object
      data={url}
      type="application/pdf"
      aria-label={`PDF preview: ${name}`}
      className="h-[440px] w-full rounded-lg border border-slate-200 bg-white dark:border-slate-700"
    >
      <p className="p-3 text-xs text-slate-600">
        This browser cannot display the PDF inline. Use the download link below instead.
      </p>
    </object>
  )
}
