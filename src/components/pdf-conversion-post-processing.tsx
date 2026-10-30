import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react'
import { useId, useRef } from 'react'
import { AttachmentMetadataEditor } from '#/components/attachment-metadata-editor'
import { OverlayAppearanceEditor } from '#/components/overlay-appearance-editor'
import { PdfMetadataEditor } from '#/components/pdf-structure-editors'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import { Switch } from '#/components/ui/switch'
import { UploadZone } from '#/components/upload-zone'
import { removeTextOverlayAppearance } from '#/lib/overlay-appearance'
import {
  configuredOverlays,
  OVERLAY_KINDS,
  type OverlayKind,
  type OverlaySettings,
  overlayUploads,
  type PdfPostProcess,
  type PostProcessFiles,
} from '#/lib/pdf-post-processing'

type Props = {
  mode?: 'convert' | 'merge' | 'split'
  value: PdfPostProcess
  onChange: (value: PdfPostProcess) => void
  files: PostProcessFiles
  onFilesChange: (files: PostProcessFiles) => void
}

const permissions = [
  ['allowPrinting', 'Printing'],
  ['allowCopying', 'Copying'],
  ['allowModifying', 'Editing'],
  ['allowAnnotating', 'Annotations'],
  ['allowFillingForms', 'Filling forms'],
  ['allowAssembling', 'Page assembly'],
] as const

export function defaultOverlay(kind: OverlayKind): OverlaySettings {
  return { source: 'text', expression: kind === 'stamp' ? 'APPROVED' : 'CONFIDENTIAL' }
}

function moved<T>(items: T[], from: number, to: number): T[] {
  const copy = [...items]
  const [item] = copy.splice(from, 1)
  if (item !== undefined) copy.splice(to, 0, item)
  return copy
}

/** One list controls both the repeated scalar fields and the corresponding local file order. */
export function OverlayGroupsEditor({
  kind,
  rows,
  onRowsChange,
  files,
  onFilesChange,
  minimum = 0,
}: {
  kind: OverlayKind
  rows: OverlaySettings[]
  onRowsChange: (rows: OverlaySettings[]) => void
  files: File[]
  onFilesChange: (files: File[]) => void
  minimum?: number
}) {
  const id = useId()
  const identities = useRef<string[]>([])
  const nextIdentity = useRef(0)
  while (identities.current.length < rows.length) {
    identities.current.push(String(nextIdentity.current++))
  }
  identities.current.length = rows.length
  const change = (next: OverlaySettings[], nextFiles = files, nextIds?: string[]) => {
    if (nextIds) identities.current = nextIds
    onRowsChange(next)
    // Filter removed assets and order the remaining ones by their visible rows.
    onFilesChange(
      next.flatMap((row) =>
        row.source === 'text' ? [] : nextFiles.filter((file) => file.name === row.expression),
      ),
    )
  }
  return (
    <section className="space-y-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100 capitalize">
            {kind}s
          </h3>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Applied top to bottom, {kind === 'watermark' ? 'behind' : 'over'} the page content.
          </p>
        </div>
        <button
          type="button"
          disabled={rows.length >= 10}
          className="inline-flex h-9 items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 px-3 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-40"
          onClick={() => change([...rows, defaultOverlay(kind)])}
        >
          <Plus className="size-4" /> Add {kind}
        </button>
      </div>
      <p className="text-xs leading-5 text-slate-500 dark:text-slate-400">
        Image/PDF entries need one local upload or a matching downloadFrom entry. Remote files
        precede local uploads of the same type; each remote response must provide the filename
        entered here through Content-Disposition.
      </p>
      <ol className="space-y-3">
        {rows.map((row, index) => {
          const file = files.find((entry) => entry.name === row.expression)
          const update = (patch: Partial<OverlaySettings>) =>
            change(
              rows.map((entry, position) => (position === index ? { ...entry, ...patch } : entry)),
            )
          return (
            <li
              key={identities.current[index]}
              className="space-y-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-800/50 p-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="text-xs font-semibold text-slate-700 dark:text-slate-200 capitalize">
                  {kind} {index + 1}
                </h4>
                <div className="flex gap-1">
                  <button
                    type="button"
                    aria-label={`Move ${kind} ${index + 1} up`}
                    disabled={index === 0}
                    className="rounded-md p-2 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-30"
                    onClick={() =>
                      change(
                        moved(rows, index, index - 1),
                        files,
                        moved(identities.current, index, index - 1),
                      )
                    }
                  >
                    <ArrowUp className="size-4" />
                  </button>
                  <button
                    type="button"
                    aria-label={`Move ${kind} ${index + 1} down`}
                    disabled={index === rows.length - 1}
                    className="rounded-md p-2 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-30"
                    onClick={() =>
                      change(
                        moved(rows, index, index + 1),
                        files,
                        moved(identities.current, index, index + 1),
                      )
                    }
                  >
                    <ArrowDown className="size-4" />
                  </button>
                  <button
                    type="button"
                    aria-label={`Remove ${kind} ${index + 1}`}
                    disabled={rows.length <= minimum}
                    className="rounded-md p-2 text-slate-600 dark:text-slate-300 hover:bg-red-50 dark:hover:bg-red-950/60 hover:text-red-700 dark:hover:text-red-300 disabled:opacity-30"
                    onClick={() =>
                      change(
                        rows.filter((_, position) => position !== index),
                        files,
                        identities.current.filter((_, position) => position !== index),
                      )
                    }
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`${id}-${index}-source`}>Source</Label>
                <select
                  id={`${id}-${index}-source`}
                  value={row.source}
                  className="h-10 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 text-sm"
                  onChange={(event) => {
                    const source = event.target.value as OverlaySettings['source']
                    update({
                      source,
                      expression: source === 'text' ? defaultOverlay(kind).expression : '',
                      options:
                        source === 'text' ? row.options : removeTextOverlayAppearance(row.options),
                    })
                  }}
                >
                  <option value="text">Text</option>
                  <option value="image">Image</option>
                  <option value="pdf">PDF</option>
                </select>
              </div>
              {row.source === 'text' ? (
                <div className="space-y-1.5">
                  <Label htmlFor={`${id}-${index}-text`}>Overlay text</Label>
                  <Input
                    id={`${id}-${index}-text`}
                    value={row.expression ?? ''}
                    onChange={(event) => update({ expression: event.target.value })}
                  />
                </div>
              ) : (
                <>
                  <UploadZone
                    label={`${kind} ${row.source.toUpperCase()} file`}
                    description="Choose a local file, or enter the filename of a remote download below."
                    files={file ? [file] : []}
                    onChange={(chosen) => {
                      const nextFiles = files.filter((item) => item !== file)
                      if (chosen[0]) nextFiles.push(chosen[0])
                      change(
                        rows.map((entry, position) =>
                          position === index
                            ? { ...entry, expression: chosen[0]?.name ?? '' }
                            : entry,
                        ),
                        nextFiles,
                      )
                    }}
                    accept={row.source === 'pdf' ? '.pdf,application/pdf' : 'image/*'}
                  />
                  {!file && (
                    <div className="space-y-1.5">
                      <Label htmlFor={`${id}-${index}-remote-name`}>Remote filename</Label>
                      <Input
                        id={`${id}-${index}-remote-name`}
                        value={row.expression ?? ''}
                        placeholder="Filename in remote Content-Disposition"
                        onChange={(event) => update({ expression: event.target.value })}
                      />
                    </div>
                  )}
                </>
              )}
              <div className="space-y-1.5">
                <Label htmlFor={`${id}-${index}-pages`}>Pages (optional)</Label>
                <Input
                  id={`${id}-${index}-pages`}
                  value={row.pages ?? ''}
                  placeholder="1-3, 5"
                  onChange={(event) => update({ pages: event.target.value })}
                />
              </div>
              <OverlayAppearanceEditor
                source={row.source}
                options={row.options}
                onChange={(options) => update({ options: options || undefined })}
              />
            </li>
          )
        })}
      </ol>
    </section>
  )
}

export function PdfConversionPostProcessing({
  mode = 'convert',
  value,
  onChange,
  files,
  onFilesChange,
}: Props) {
  const id = useId()
  const update = (patch: Partial<PdfPostProcess>) => onChange({ ...value, ...patch })
  return (
    <details className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/40">
      <summary className="cursor-pointer px-4 py-4 text-sm font-semibold text-slate-700 dark:text-slate-200">
        PDF post-processing (optional)
      </summary>
      <div className="space-y-5 border-t border-slate-200 dark:border-slate-700 px-4 py-5">
        <p className="text-xs leading-5 text-slate-600 dark:text-slate-300">
          {mode === 'merge'
            ? 'Add overlays, attachments and security to the merged PDF in one request.'
            : mode === 'split'
              ? 'Apply overlays, attachments and security to the split PDFs in one request.'
              : 'Apply PDF-engine features during conversion in one request, without an intermediate PDF.'}
        </p>
        {OVERLAY_KINDS.map((kind) => {
          const plural = kind === 'watermark' ? 'watermarks' : 'stamps'
          return (
            <OverlayGroupsEditor
              key={kind}
              kind={kind}
              rows={configuredOverlays(value, kind)}
              onRowsChange={(rows) => {
                const next = { ...value }
                delete next[kind]
                if (rows.length) next[plural] = rows
                else delete next[plural]
                onChange(next)
              }}
              files={overlayUploads(files, kind)}
              onFilesChange={(uploads) => onFilesChange({ ...files, [kind]: uploads })}
            />
          )
        })}
        <div className="space-y-4 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4">
          <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Rotate pages</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Rotate all pages or specific page ranges without running another PDF operation.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor={`${id}-rotate-angle`}>Rotation angle</Label>
              <select
                id={`${id}-rotate-angle`}
                value={value.rotateAngle ?? ''}
                onChange={(event) => {
                  const angle = event.target.value as PdfPostProcess['rotateAngle'] | ''
                  update({
                    rotateAngle: angle || undefined,
                    rotatePages: angle ? value.rotatePages : undefined,
                  })
                }}
                className="h-10 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 text-sm"
              >
                <option value="">Do not rotate</option>
                <option value="90">90°</option>
                <option value="180">180°</option>
                <option value="270">270°</option>
              </select>
            </div>
            {value.rotateAngle && (
              <div className="space-y-1.5">
                <Label htmlFor={`${id}-rotate-pages`}>Pages to rotate (optional)</Label>
                <Input
                  id={`${id}-rotate-pages`}
                  value={value.rotatePages ?? ''}
                  placeholder="All pages (or 1-3, 5)"
                  onChange={(event) => update({ rotatePages: event.target.value || undefined })}
                />
              </div>
            )}
          </div>
        </div>
        <div className="space-y-4 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4">
          <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
            PDF attachments
          </h3>
          <UploadZone
            label="Embed files"
            description={
              mode === 'split'
                ? 'Embed files in the split PDFs. Remote attachments use downloadFrom field: embedded. PDF/A-3 supports attachments; PDF/A-1/2 do not.'
                : 'Attach files to the resulting PDF. Remote attachments use downloadFrom field: embedded. PDF/A-3 supports attachments; PDF/A-1/2 do not.'
            }
            files={files.embeds ?? []}
            onChange={(embeds) => onFilesChange({ ...files, embeds })}
            multiple
          />
          <AttachmentMetadataEditor
            files={files.embeds ?? []}
            value={value.embedsMetadata}
            onChange={(embedsMetadata) => update({ embedsMetadata: embedsMetadata || undefined })}
          />
        </div>
        <div className="space-y-4 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4">
          <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
            Factur-X / ZUGFeRD invoice
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Requires a local CII XML invoice and a conformance level. Gotenberg generates a PDF/A-3
            e-invoice automatically; do not choose PDF/A-1 or PDF/A-2 above. Requires a compatible
            PDF engine.
          </p>
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-facturx-level`}>Conformance level</Label>
            <select
              id={`${id}-facturx-level`}
              value={value.facturxConformanceLevel ?? ''}
              onChange={(event) => {
                const level = event.target.value as PdfPostProcess['facturxConformanceLevel']
                update({
                  facturxConformanceLevel: level || undefined,
                  facturxDocumentType: level ? value.facturxDocumentType : undefined,
                  facturxVersion: level ? value.facturxVersion : undefined,
                })
                if (!level) onFilesChange({ ...files, facturxXml: undefined })
              }}
              className="h-10 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 text-sm"
            >
              <option value="">Not enabled</option>
              {(['MINIMUM', 'BASIC WL', 'BASIC', 'EN 16931', 'EXTENDED', 'XRECHNUNG'] as const).map(
                (level) => (
                  <option key={level} value={level}>
                    {level}
                  </option>
                ),
              )}
            </select>
          </div>
          {value.facturxConformanceLevel && (
            <>
              <UploadZone
                label="CII invoice XML"
                description="Uploaded as facturxXml, not the source document or a regular attachment."
                files={files.facturxXml ? [files.facturxXml] : []}
                onChange={(chosen) => onFilesChange({ ...files, facturxXml: chosen[0] })}
                accept=".xml,text/xml,application/xml"
              />
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor={`${id}-facturx-type`}>Document type</Label>
                  <select
                    id={`${id}-facturx-type`}
                    className="h-10 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 text-sm"
                    value={value.facturxDocumentType ?? ''}
                    onChange={(event) =>
                      update({
                        facturxDocumentType: (event.target.value ||
                          undefined) as PdfPostProcess['facturxDocumentType'],
                      })
                    }
                  >
                    <option value="">INVOICE (default)</option>
                    {(['INVOICE', 'ORDER', 'ORDER_RESPONSE', 'ORDER_CHANGE'] as const).map(
                      (type) => (
                        <option key={type} value={type}>
                          {type}
                        </option>
                      ),
                    )}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`${id}-facturx-version`}>Standard version</Label>
                  <Input
                    id={`${id}-facturx-version`}
                    placeholder="1.0 (default)"
                    value={value.facturxVersion ?? ''}
                    onChange={(event) =>
                      update({ facturxVersion: event.target.value || undefined })
                    }
                  />
                </div>
              </div>
            </>
          )}
        </div>
        <div className="space-y-4 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4">
          {mode !== 'merge' && (
            <PdfMetadataEditor
              value={value.metadata ?? '{}'}
              onChange={(metadata) => update({ metadata })}
            />
          )}
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor={`${id}-flatten`}>Flatten interactive PDF fields</Label>
            <Switch
              id={`${id}-flatten`}
              checked={value.flatten === true}
              onCheckedChange={(flatten) => update({ flatten: flatten || undefined })}
            />
          </div>
        </div>
        <div className="space-y-4 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4">
          <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
            Encrypt result
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Passwords are used only for this request. PDF/A and encryption cannot be combined.
            Restrictions require a password and depend on your PDF engine.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor={`${id}-user-password`}>Open password</Label>
              <Input
                id={`${id}-user-password`}
                type="password"
                autoComplete="new-password"
                value={value.userPassword ?? ''}
                onChange={(event) => update({ userPassword: event.target.value || undefined })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${id}-owner-password`}>Owner password</Label>
              <Input
                id={`${id}-owner-password`}
                type="password"
                autoComplete="new-password"
                value={value.ownerPassword ?? ''}
                onChange={(event) => update({ ownerPassword: event.target.value || undefined })}
              />
            </div>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">Permissions (on by default)</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {permissions.map(([key, description]) => (
              <div key={key} className="flex items-center justify-between gap-3">
                <Label htmlFor={`${id}-${key}`}>{description}</Label>
                <Switch
                  id={`${id}-${key}`}
                  checked={value[key] !== false}
                  onCheckedChange={(checked) => update({ [key]: checked ? undefined : false })}
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    </details>
  )
}
