import { FolderArchive } from 'lucide-react'
import { useEffect, useId, useState } from 'react'
import { Button } from '#/components/ui/button'
import { formatBytes } from '#/lib/security'
import { inspectZipResult, type ZipResultManifest } from '#/lib/zip-result-manifest'

/** Opt-in ZIP index preview; does not decompress files or upload the archive. */
export function ZipResultPreview({ blob }: { blob: Blob }) {
  const [visible, setVisible] = useState(false)
  const [manifest, setManifest] = useState<ZipResultManifest | null>(null)
  const [error, setError] = useState<string | null>(null)
  const id = useId()

  useEffect(() => {
    if (!visible) return
    let cancelled = false
    setManifest(null)
    setError(null)
    void inspectZipResult(blob).then(
      (value) => {
        if (!cancelled) setManifest(value)
      },
      () => {
        if (!cancelled)
          setError('The ZIP index cannot be previewed here. The download is still available.')
      },
    )
    return () => {
      cancelled = true
    }
  }, [blob, visible])

  return (
    <div className="mb-4 space-y-2">
      <Button
        type="button"
        size="sm"
        variant="outline"
        aria-expanded={visible}
        aria-controls={id}
        onClick={() => setVisible((value) => !value)}
      >
        <FolderArchive className="size-4" />
        {visible ? 'Hide archive contents' : 'View archive contents'}
      </Button>
      <div id={id} hidden={!visible}>
        {visible && (
          <div className="rounded-lg border border-slate-200 p-3 text-xs dark:border-slate-700">
            {error && <p role="status">{error}</p>}
            {!manifest && !error && <p role="status">Reading ZIP directory...</p>}
            {manifest && (
              <>
                <p className="font-semibold">
                  {manifest.totalFiles} file(s) · {formatBytes(manifest.totalUncompressedBytes)}{' '}
                  uncompressed
                </p>
                <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto" aria-label="Archive files">
                  {manifest.entries.map((entry) => (
                    <li key={entry.id} className="flex justify-between gap-3">
                      <span className="min-w-0 break-all">{entry.name}</span>
                      <span className="shrink-0 text-slate-500 dark:text-slate-400">
                        {entry.kind} · {formatBytes(entry.size)}
                      </span>
                    </li>
                  ))}
                </ul>
                {manifest.totalFiles > manifest.entries.length && (
                  <p className="mt-2 text-slate-500 dark:text-slate-400">
                    Showing the first {manifest.entries.length} files.
                  </p>
                )}
                <p className="mt-2 text-slate-500 dark:text-slate-400">
                  Names and sizes only. Download the ZIP to view the documents or images.
                </p>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
