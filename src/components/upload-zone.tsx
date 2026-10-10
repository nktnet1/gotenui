import { ArrowDown, ArrowUp, FileText, UploadCloud, X } from 'lucide-react'
import { useId, useRef, useState } from 'react'
import { Button } from '#/components/ui/button'
import { formatBytes } from '#/lib/security'
import { cn } from '#/lib/utils'

interface UploadZoneProps {
  label: string
  description: string
  files: File[]
  onChange: (files: File[]) => void
  accept?: string
  multiple?: boolean
  reorder?: boolean
  maxFiles?: number
}

export function UploadZone({
  label,
  description,
  files,
  onChange,
  accept,
  multiple = false,
  reorder = false,
  maxFiles = 20,
}: UploadZoneProps) {
  const id = useId()
  const ref = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const addFiles = (newFiles: File[]) => {
    const existing = multiple ? files : []
    onChange(
      [...existing, ...newFiles]
        .filter(
          (file, index, all) =>
            all.findIndex(
              (candidate) => candidate.name.toLowerCase() === file.name.toLowerCase(),
            ) === index,
        )
        .slice(0, maxFiles),
    )
    if (ref.current) ref.current.value = ''
  }
  const move = (index: number, offset: number) => {
    const next = [...files]
    const target = index + offset
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target] as File, next[index] as File]
    onChange(next)
  }
  return (
    <div className="space-y-3">
      <div>
        <label className="text-[13px] font-semibold text-slate-700" htmlFor={id}>
          {label}
        </label>
        <p className="mt-1 text-xs leading-5 text-slate-500">{description}</p>
      </div>
      <fieldset
        aria-label={`${label} drop area`}
        className={cn(
          'group relative flex min-h-40 flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-200 bg-slate-50/60 px-5 py-7 text-center transition-all hover:border-sky-300 hover:bg-sky-50/50',
          dragging && 'border-sky-500 bg-sky-50',
        )}
        onDragEnter={(event) => {
          event.preventDefault()
          setDragging(true)
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={(event) => {
          event.preventDefault()
          setDragging(false)
        }}
        onDrop={(event) => {
          event.preventDefault()
          setDragging(false)
          addFiles(Array.from(event.dataTransfer.files))
        }}
      >
        <div className="mb-3 flex size-10 items-center justify-center rounded-xl border border-slate-200 bg-white shadow-sm">
          <UploadCloud className="size-5 text-sky-600" />
        </div>
        <p className="text-sm font-semibold text-slate-800">
          Drop files here or{' '}
          <button
            type="button"
            className="text-sky-600 underline-offset-2 hover:underline"
            onClick={() => ref.current?.click()}
          >
            browse
          </button>
        </p>
        <p className="mt-1 text-xs text-slate-400">
          {multiple ? `Up to ${maxFiles} files` : 'One file'} · Drag and drop supported
        </p>
        <input
          id={id}
          ref={ref}
          className="sr-only"
          type="file"
          tabIndex={-1}
          accept={accept}
          multiple={multiple}
          onChange={(event) => addFiles(Array.from(event.target.files ?? []))}
        />
      </fieldset>
      {files.length > 0 && (
        <ul className="space-y-2" aria-label={`${label} selected files`}>
          {files.map((file, index) => (
            <li
              key={file.name.toLowerCase()}
              className="flex min-w-0 items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2.5"
            >
              <FileText className="size-4 shrink-0 text-slate-500" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-semibold text-slate-800">{file.name}</p>
                <p className="text-[11px] text-slate-400">{formatBytes(file.size)}</p>
              </div>
              {reorder && (
                <div className="flex items-center gap-0.5">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Move ${file.name} up`}
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                  >
                    <ArrowUp className="size-3.5" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Move ${file.name} down`}
                    disabled={index === files.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    <ArrowDown className="size-3.5" />
                  </Button>
                </div>
              )}
              <Button
                type="button"
                size="icon"
                variant="ghost"
                aria-label={`Remove ${file.name}`}
                onClick={() => onChange(files.filter((_, i) => i !== index))}
              >
                <X className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
