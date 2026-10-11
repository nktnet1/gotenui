import { Plus, Trash2 } from 'lucide-react'
import { useEffect, useId, useState } from 'react'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import { Textarea } from '#/components/ui/textarea'
import {
  ATTACHMENT_RELATIONSHIPS,
  addRemoteAttachmentMetadata,
  deleteAttachmentMetadata,
  parseAttachmentMetadata,
  setAttachmentMetadata,
} from '#/lib/attachment-metadata'

function MimeTypeInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const id = useId()
  const [draft, setDraft] = useState(value)
  const [error, setError] = useState('')
  useEffect(() => {
    setDraft(value)
    setError('')
  }, [value])
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>MIME type</Label>
      <Input
        id={id}
        value={draft}
        placeholder="application/xml"
        aria-invalid={Boolean(error)}
        aria-describedby={`${id}-help`}
        onChange={(event) => {
          setDraft(event.target.value)
          setError('')
        }}
        onBlur={() => {
          try {
            onChange(draft)
            setError('')
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'Invalid MIME type.')
          }
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
        }}
      />
      <p
        id={`${id}-help`}
        className={`text-xs ${error ? 'text-red-600 dark:text-red-400' : 'text-slate-500 dark:text-slate-400'}`}
      >
        {error || 'Optional. Sets the attachment stream subtype.'}
      </p>
    </div>
  )
}

/** Shared by the standalone embed route and conversion-time PDF attachments. */
export function AttachmentMetadataEditor({
  files,
  value,
  onChange,
}: {
  files: readonly File[]
  value: string | undefined
  onChange: (value: string) => void
}) {
  const id = useId()
  const metadata = parseAttachmentMetadata(value)
  const [remoteFilename, setRemoteFilename] = useState('')
  const [error, setError] = useState('')
  const names = [...new Set([...files.map((file) => file.name), ...Object.keys(metadata ?? {})])]
  return (
    <section className="space-y-3">
      <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
        Attachment metadata (PDF/A-3)
      </h4>
      <p className="text-xs leading-5 text-slate-500 dark:text-slate-400">
        Optionally set each embedded file’s MIME type and associated-file relationship. The upstream
        PDF engine must support attachment metadata (QPDF by default).
      </p>
      {!metadata && (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400">
          Correct the custom metadata JSON below before editing individual files.
        </p>
      )}
      <fieldset disabled={!metadata} className="space-y-3 disabled:opacity-50">
        {names.map((filename) => (
          <div
            key={filename}
            className="space-y-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/50 p-3"
          >
            <div className="flex items-center justify-between gap-2">
              <h5 className="min-w-0 break-all text-xs font-semibold text-slate-700 dark:text-slate-200">
                {filename}
              </h5>
              {metadata?.[filename] && (
                <button
                  type="button"
                  aria-label={`Clear metadata for ${filename}`}
                  onClick={() => onChange(deleteAttachmentMetadata(value, filename))}
                  className="shrink-0 rounded-md p-2 text-slate-600 dark:text-slate-300 hover:bg-red-50 dark:hover:bg-red-950/60 hover:text-red-700 dark:hover:text-red-300"
                >
                  <Trash2 className="size-4" />
                </button>
              )}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <MimeTypeInput
                value={metadata?.[filename]?.mimeType ?? ''}
                onChange={(input) =>
                  onChange(setAttachmentMetadata(value, filename, 'mimeType', input))
                }
              />
              <div className="space-y-1.5">
                <Label htmlFor={`${id}-${filename}-relationship`}>PDF/A relationship</Label>
                <select
                  id={`${id}-${filename}-relationship`}
                  className="h-10 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 text-sm"
                  value={metadata?.[filename]?.relationship ?? ''}
                  onChange={(event) =>
                    onChange(
                      setAttachmentMetadata(value, filename, 'relationship', event.target.value),
                    )
                  }
                >
                  <option value="">Not specified</option>
                  {ATTACHMENT_RELATIONSHIPS.map((relationship) => (
                    <option key={relationship} value={relationship}>
                      {relationship}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        ))}
        <div className="space-y-2">
          <Label htmlFor={`${id}-remote`}>Remote attachment filename</Label>
          <div className="flex flex-wrap gap-2">
            <Input
              id={`${id}-remote`}
              className="min-w-40 flex-1"
              value={remoteFilename}
              placeholder="Filename from Content-Disposition"
              onChange={(event) => {
                setRemoteFilename(event.target.value)
                setError('')
              }}
            />
            <button
              type="button"
              className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-300 dark:border-slate-600 px-3 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700"
              onClick={() => {
                try {
                  onChange(addRemoteAttachmentMetadata(value, remoteFilename))
                  setRemoteFilename('')
                  setError('')
                } catch (cause) {
                  setError(cause instanceof Error ? cause.message : 'Invalid attachment name.')
                }
              }}
            >
              <Plus className="size-4" /> Add filename
            </button>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Use for downloadFrom attachments. Match the remote file’s exact Content-Disposition
            filename.
          </p>
          {error && (
            <p role="alert" className="text-xs text-red-600 dark:text-red-400">
              {error}
            </p>
          )}
        </div>
      </fieldset>
      <details className="rounded-lg border border-slate-200 dark:border-slate-700 p-3">
        <summary className="cursor-pointer text-xs font-semibold text-slate-700 dark:text-slate-200">
          Custom attachment metadata JSON
        </summary>
        <div className="mt-3 space-y-2">
          <Label htmlFor={`${id}-json`}>embedsMetadata JSON</Label>
          <Textarea
            id={`${id}-json`}
            rows={3}
            className="font-mono text-xs"
            spellCheck={false}
            placeholder={
              '{"invoice.xml":{"mimeType":"application/xml","relationship":"Alternative"}}'
            }
            value={value ?? ''}
            onChange={(event) => onChange(event.target.value)}
          />
        </div>
      </details>
    </section>
  )
}
