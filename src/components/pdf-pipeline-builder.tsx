import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react'
import { useRef, useState } from 'react'
import { Button } from '#/components/ui/button'
import { Label } from '#/components/ui/label'
import { Textarea } from '#/components/ui/textarea'
import {
  DEFAULT_PDF_PIPELINE,
  PDF_PIPELINE_STAGES,
  type PdfPipelineOp,
  parsePdfPipeline,
  safePipelinePreview,
} from '#/lib/pdf-pipeline'

type EditorStage = { id: number; op: PdfPipelineOp; settings: string }

function initialStages(value: string): EditorStage[] {
  try {
    const stages = JSON.parse(value) as { op: PdfPipelineOp; [key: string]: unknown }[]
    if (!Array.isArray(stages) || !stages.length) return initialStages(DEFAULT_PDF_PIPELINE)
    return stages.map(({ op, ...options }, id) => ({
      id,
      op,
      settings: JSON.stringify(options, null, 2),
    }))
  } catch {
    return initialStages(DEFAULT_PDF_PIPELINE)
  }
}

function serialize(stages: readonly EditorStage[]): string {
  return JSON.stringify(
    stages.map(({ op, settings }) => {
      const options: unknown = JSON.parse(settings)
      if (!options || typeof options !== 'object' || Array.isArray(options)) {
        throw new Error('Every stage needs a JSON object of options.')
      }
      if ('op' in options)
        throw new Error('Do not include op in stage settings; choose the stage type above.')
      return { op, ...options }
    }),
  )
}

/** Accessible, ordered step editor. The server independently revalidates every stage. */
export function PdfPipelineBuilder({
  value,
  onChange,
  acknowledgedRedaction,
  onRedactionChange,
  error,
  conversionMode = false,
}: {
  value: string
  onChange: (value: string) => void
  acknowledgedRedaction: boolean
  onRedactionChange: (value: boolean) => void
  error: string | null
  conversionMode?: boolean
}) {
  const [stages, setStages] = useState<EditorStage[]>(() => initialStages(value))
  const [selected, setSelected] = useState<PdfPipelineOp>('select')
  const nextId = useRef(Math.max(...initialStages(value).map(({ id }) => id)) + 1)
  const [editorError, setEditorError] = useState<string | null>(null)
  const availableStages = conversionMode
    ? PDF_PIPELINE_STAGES.filter(({ op }) => op !== 'decrypt')
    : PDF_PIPELINE_STAGES

  const update = (next: EditorStage[]) => {
    setStages(next)
    try {
      const serialized = serialize(next)
      setEditorError(null)
      onChange(serialized)
    } catch (cause) {
      setEditorError(cause instanceof Error ? cause.message : 'Invalid stage settings JSON.')
      // Never submit previously valid stages when the visible editor contains invalid JSON.
      onChange('[')
    }
  }
  const add = () => {
    if (stages.length >= 30) return
    const definition = availableStages.find(({ op }) => op === selected)
    if (!definition) return
    update([
      ...stages,
      { id: nextId.current++, op: selected, settings: JSON.stringify(definition.options, null, 2) },
    ])
  }
  const move = (from: number, to: number) => {
    if (to < 0 || to >= stages.length) return
    const next = [...stages]
    const entry = next.splice(from, 1)[0]
    if (!entry) return
    next.splice(to, 0, entry)
    update(next)
  }
  const preview = (() => {
    try {
      return safePipelinePreview(
        parsePdfPipeline(serialize(stages), { acknowledgedRedaction: true }),
      )
    } catch {
      return null
    }
  })()
  const redact = stages.some(({ op }) => op === 'redact')

  return (
    <div className="space-y-4" data-testid="pdf-pipeline-builder">
      <div className="rounded-xl border border-sky-200 bg-sky-50/70 p-4 dark:border-sky-900 dark:bg-sky-950/20">
        <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
          Ordered processing pipeline
        </p>
        <p className="mt-1 text-xs leading-5 text-slate-600 dark:text-slate-300">
          Stages run from top to bottom. Use the arrows to change their order; the final stage
          determines whether Gotenberg returns PDFs or rendered images. Each stage accepts the exact
          Gotenberg 9 option names as JSON.
        </p>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div className="min-w-52 flex-1 space-y-1">
            <Label htmlFor="pipeline-stage-kind">Add processing stage</Label>
            <select
              id="pipeline-stage-kind"
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              value={selected}
              onChange={(event) => setSelected(event.target.value as PdfPipelineOp)}
            >
              {availableStages.map(({ op, label }) => (
                <option key={op} value={op}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <Button type="button" variant="outline" onClick={add} disabled={stages.length >= 30}>
            <Plus className="size-4" /> Add stage
          </Button>
        </div>
      </div>
      <ol className="space-y-3" aria-label="Ordered PDF processing stages">
        {stages.map((stage, index) => {
          const definition = PDF_PIPELINE_STAGES.find(({ op }) => op === stage.op)
          return (
            <li
              key={stage.id}
              className="rounded-xl border border-slate-200 p-4 dark:border-slate-700"
            >
              <div className="flex flex-wrap items-start gap-3">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-sky-100 text-xs font-bold text-sky-800 dark:bg-sky-900 dark:text-sky-100">
                  {index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {definition?.label ?? stage.op}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                    {definition?.description}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    aria-label={`Move ${definition?.label} up`}
                    disabled={index === 0}
                    onClick={() => move(index, index - 1)}
                  >
                    <ArrowUp className="size-4" />
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    aria-label={`Move ${definition?.label} down`}
                    disabled={index === stages.length - 1}
                    onClick={() => move(index, index + 1)}
                  >
                    <ArrowDown className="size-4" />
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    aria-label={`Remove ${definition?.label}`}
                    disabled={stages.length === 1}
                    onClick={() => update(stages.filter(({ id }) => id !== stage.id))}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </div>
              <div className="mt-3 space-y-1">
                <Label htmlFor={`pipeline-options-${stage.id}`}>Stage settings (JSON)</Label>
                <Textarea
                  id={`pipeline-options-${stage.id}`}
                  rows={Math.min(9, Math.max(2, stage.settings.split('\n').length))}
                  className="font-mono text-xs"
                  spellCheck={false}
                  value={stage.settings}
                  onChange={(event) =>
                    update(
                      stages.map((item) =>
                        item.id === stage.id ? { ...item, settings: event.target.value } : item,
                      ),
                    )
                  }
                />
              </div>
            </li>
          )
        })}
      </ol>
      {redact && (
        <label className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
          <input
            type="checkbox"
            checked={acknowledgedRedaction}
            onChange={(event) => onRedactionChange(event.target.checked)}
            className="mt-0.5"
          />
          <span>
            I understand that redaction permanently removes content from the processed PDF. I will
            verify the result before sharing it.
          </span>
        </label>
      )}
      {(editorError || error) && (
        <p
          role="alert"
          className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/20 dark:text-amber-100"
        >
          {editorError || error}
        </p>
      )}
      {preview && (
        <details className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
          <summary className="cursor-pointer text-xs font-semibold text-slate-700 dark:text-slate-200">
            Preview ordered stages (credentials hidden)
          </summary>
          <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap break-all font-mono text-xs text-slate-500 dark:text-slate-300">
            {preview}
          </pre>
        </details>
      )}
      <p className="text-xs text-slate-500 dark:text-slate-400">
        Referenced assets must be uploaded under “
        {conversionMode ? 'Pipeline stage files' : 'Additional stage files'}” with exactly matching
        filenames. Passwords entered in the JSON editor are visible while editing, but hidden in the
        preview.
      </p>
    </div>
  )
}
