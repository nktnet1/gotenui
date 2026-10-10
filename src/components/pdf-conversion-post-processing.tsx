import { useId } from 'react'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import { Switch } from '#/components/ui/switch'
import { Textarea } from '#/components/ui/textarea'
import { UploadZone } from '#/components/upload-zone'
import type { OverlaySettings, PdfPostProcess, PostProcessFiles } from '#/lib/pdf-post-processing'

type Props = {
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

function OverlayEditor({
  kind,
  value,
  onChange,
  file,
  onFileChange,
}: {
  kind: 'watermark' | 'stamp'
  value: OverlaySettings | undefined
  onChange: (value: OverlaySettings | undefined) => void
  file: File | undefined
  onFileChange: (file: File | undefined) => void
}) {
  const id = useId()
  const enabled = value !== undefined
  const update = (patch: Partial<OverlaySettings>) => value && onChange({ ...value, ...patch })
  return (
    <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <Label htmlFor={id} className="capitalize">
            {kind}
          </Label>
          <p className="mt-1 text-xs text-slate-500">
            {kind === 'watermark' ? 'Behind the page content.' : 'On top of the page content.'}
          </p>
        </div>
        <Switch
          id={id}
          checked={enabled}
          onCheckedChange={(checked) => {
            onChange(
              checked
                ? { source: 'text', expression: kind === 'stamp' ? 'APPROVED' : 'CONFIDENTIAL' }
                : undefined,
            )
            onFileChange(undefined)
          }}
        />
      </div>
      {value && (
        <div className="space-y-4 border-t border-slate-100 pt-4">
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-source`}>Source</Label>
            <select
              id={`${id}-source`}
              value={value.source}
              onChange={(event) => {
                const source = event.target.value as OverlaySettings['source']
                onChange({ source, expression: source === 'text' ? 'CONFIDENTIAL' : '' })
                onFileChange(undefined)
              }}
              className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm"
            >
              <option value="text">Text</option>
              <option value="image">Image</option>
              <option value="pdf">PDF</option>
            </select>
          </div>
          {value.source === 'text' ? (
            <div className="space-y-1.5">
              <Label htmlFor={`${id}-text`}>Overlay text</Label>
              <Input
                id={`${id}-text`}
                value={value.expression ?? ''}
                onChange={(event) => update({ expression: event.target.value })}
              />
            </div>
          ) : (
            <>
              <UploadZone
                label={`${kind} ${value.source.toUpperCase()} file`}
                description="Choose one local file, or provide a remote downloadFrom entry with its field set to the overlay type."
                files={file ? [file] : []}
                onChange={(chosen) => {
                  onFileChange(chosen[0])
                  update({ expression: chosen[0]?.name ?? '' })
                }}
                accept={value.source === 'pdf' ? '.pdf,application/pdf' : 'image/*'}
              />
              {!file && (
                <div className="space-y-1.5">
                  <Label htmlFor={`${id}-remote-name`}>Remote filename (required)</Label>
                  <Input
                    id={`${id}-remote-name`}
                    value={value.expression ?? ''}
                    onChange={(event) => update({ expression: event.target.value })}
                    placeholder="From the remote Content-Disposition header"
                  />
                </div>
              )}
            </>
          )}
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-pages`}>Pages (optional)</Label>
            <Input
              id={`${id}-pages`}
              value={value.pages ?? ''}
              onChange={(event) => update({ pages: event.target.value })}
              placeholder="1-3, 5"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-options`}>PDF-engine options JSON (optional)</Label>
            <Textarea
              id={`${id}-options`}
              rows={3}
              className="font-mono text-xs"
              value={value.options ?? ''}
              placeholder={'{"opacity":0.25,"rotation":45}'}
              onChange={(event) => update({ options: event.target.value })}
            />
          </div>
        </div>
      )}
    </div>
  )
}

export function PdfConversionPostProcessing({ value, onChange, files, onFilesChange }: Props) {
  const id = useId()
  const update = (patch: Partial<PdfPostProcess>) => onChange({ ...value, ...patch })
  return (
    <details className="rounded-xl border border-slate-200 bg-slate-50/50">
      <summary className="cursor-pointer px-4 py-4 text-sm font-semibold text-slate-700">
        PDF post-processing (optional)
      </summary>
      <div className="space-y-5 border-t border-slate-200 px-4 py-5">
        <p className="text-xs leading-5 text-slate-600">
          Apply PDF-engine features as part of this conversion. Gotenberg processes the document in
          a single request; no intermediate PDF is stored in Gotenui.
        </p>
        {(['watermark', 'stamp'] as const).map((kind) => (
          <OverlayEditor
            key={kind}
            kind={kind}
            value={value[kind]}
            onChange={(overlay) => update({ [kind]: overlay })}
            file={files[kind]}
            onFileChange={(file) => onFilesChange({ ...files, [kind]: file })}
          />
        ))}
        <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
          <h3 className="text-sm font-semibold text-slate-800">PDF attachments</h3>
          <UploadZone
            label="Embed files"
            description="Attach files to the resulting PDF, not the HTML or Office source. Remote attachments use downloadFrom field: embedded. PDF/A-3 supports attachments; PDF/A-1/2 do not."
            files={files.embeds ?? []}
            onChange={(embeds) => onFilesChange({ ...files, embeds })}
            multiple
          />
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-embeds-metadata`}>Attachment metadata JSON (optional)</Label>
            <Textarea
              id={`${id}-embeds-metadata`}
              className="font-mono text-xs"
              rows={3}
              placeholder={'{"invoice.xml":{"mimeType":"text/xml","relationship":"Alternative"}}'}
              value={value.embedsMetadata ?? ''}
              onChange={(event) => update({ embedsMetadata: event.target.value || undefined })}
            />
          </div>
        </div>
        <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
          <h3 className="text-sm font-semibold text-slate-800">Factur-X / ZUGFeRD invoice</h3>
          <p className="text-xs text-slate-500">
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
              className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm"
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
                    className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm"
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
        <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-metadata`}>PDF metadata JSON (optional)</Label>
            <Textarea
              id={`${id}-metadata`}
              className="font-mono text-xs"
              rows={3}
              value={value.metadata ?? ''}
              onChange={(event) => update({ metadata: event.target.value || undefined })}
              placeholder={'{"Author":"Gotenui","Title":"Report"}'}
            />
          </div>
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor={`${id}-flatten`}>Flatten interactive PDF fields</Label>
            <Switch
              id={`${id}-flatten`}
              checked={value.flatten === true}
              onCheckedChange={(flatten) => update({ flatten: flatten || undefined })}
            />
          </div>
        </div>
        <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
          <h3 className="text-sm font-semibold text-slate-800">Encrypt result</h3>
          <p className="text-xs text-slate-500">
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
          <p className="text-xs text-slate-500">Permissions (on by default)</p>
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
