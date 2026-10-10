import { ArrowDown, ArrowUp, FilePlus2, RotateCcw, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import { Textarea } from '#/components/ui/textarea'
import { defaultMarkdownTemplate } from '#/lib/chromium-documents'
import { safeFilename } from '#/lib/validation'

export type MarkdownSource = { id: number; name: string; content: string }

type Props = {
  primaryName: string
  onPrimaryNameChange: (name: string) => void
  sources: MarkdownSource[]
  onSourcesChange: (sources: MarkdownSource[]) => void
  nextId: () => number
  customTemplate: string | null
  onCustomTemplateChange: (html: string | null) => void
}

export function MarkdownAssetsEditor({
  primaryName,
  onPrimaryNameChange,
  sources,
  onSourcesChange,
  nextId,
  customTemplate,
  onCustomTemplateChange,
}: Props) {
  const names = [primaryName, ...sources.map((file) => file.name)]
  const autoTemplate = defaultMarkdownTemplate(names)
  const update = (id: number, change: Partial<MarkdownSource>) =>
    onSourcesChange(sources.map((file) => (file.id === id ? { ...file, ...change } : file)))
  const move = (index: number, delta: number) => {
    const target = index + delta
    if (target < 0 || target >= sources.length) return
    const next = [...sources]
    ;[next[index], next[target]] = [next[target] as MarkdownSource, next[index] as MarkdownSource]
    onSourcesChange(next)
  }
  const add = () => {
    if (sources.length >= 19) return
    let number = 2
    while (names.some((name) => name.toLowerCase() === `chapter-${number}.md`)) number++
    onSourcesChange([...sources, { id: nextId(), name: `chapter-${number}.md`, content: '' }])
  }
  const importFiles = async (selected: File[]) => {
    if (!selected.length) return
    if (sources.length + selected.length > 19) {
      toast.error('A Markdown document can contain at most 20 sources, including the first.')
      return
    }
    const seen = new Set(names.map((name) => name.toLowerCase()))
    const added: MarkdownSource[] = []
    try {
      for (const file of selected) {
        safeFilename(file.name)
        if (!/\.md$/i.test(file.name) || !file.size || file.size > 300_000) {
          throw new Error(`Choose a non-empty .md file under 300 KB: ${file.name}`)
        }
        if (seen.has(file.name.toLowerCase())) {
          throw new Error(`Duplicate Markdown filename: ${file.name}`)
        }
        seen.add(file.name.toLowerCase())
        added.push({ id: nextId(), name: file.name, content: await file.text() })
      }
      onSourcesChange([...sources, ...added])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not import the Markdown files.')
    }
  }
  const importTemplate = async (file: File | undefined) => {
    if (!file) return
    if (!/\.html?$/i.test(file.name) || !file.size || file.size > 150_000) {
      toast.error('Choose a non-empty HTML template under 150 KB.')
      return
    }
    try {
      onCustomTemplateChange(await file.text())
    } catch {
      toast.error('Could not read the Markdown template.')
    }
  }
  return (
    <section className="space-y-5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/40 p-4">
      <div>
        <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
          Markdown documents and template
        </h3>
        <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">
          Gotenberg renders Markdown files in the order of the toHTML calls in index.html. Generated
          templates follow the source order shown here; custom templates control their own order.
        </p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="markdown-primary-name">First Markdown filename</Label>
        <Input
          id="markdown-primary-name"
          value={primaryName}
          onChange={(event) => onPrimaryNameChange(event.target.value)}
          placeholder="document.md"
          className="font-mono text-xs"
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={add}
          disabled={sources.length >= 19}
        >
          <FilePlus2 className="size-4" /> Add Markdown source
        </Button>
        <label className="cursor-pointer rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700">
          Import .md files
          <input
            type="file"
            accept=".md,text/markdown"
            multiple
            className="sr-only"
            onChange={(event) => {
              const selected = event.currentTarget.files
              // FileList is live, so snapshot before clearing the input.
              const files = selected ? Array.from(selected) : []
              event.currentTarget.value = ''
              void importFiles(files)
            }}
          />
        </label>
      </div>
      {sources.map((file, index) => (
        <div
          key={file.id}
          className="space-y-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">
              Source {index + 2}
            </span>
            <div className="flex items-center gap-1">
              <Button
                type="button"
                size="icon"
                variant="ghost"
                disabled={index === 0}
                aria-label={`Move ${file.name} up`}
                onClick={() => move(index, -1)}
              >
                <ArrowUp className="size-4" />
              </Button>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                disabled={index === sources.length - 1}
                aria-label={`Move ${file.name} down`}
                onClick={() => move(index, 1)}
              >
                <ArrowDown className="size-4" />
              </Button>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                aria-label={`Remove ${file.name}`}
                onClick={() => onSourcesChange(sources.filter((entry) => entry.id !== file.id))}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          </div>
          <Label htmlFor={`markdown-name-${file.id}`}>Filename</Label>
          <Input
            id={`markdown-name-${file.id}`}
            value={file.name}
            onChange={(event) => update(file.id, { name: event.target.value })}
            className="font-mono text-xs"
          />
          <Label htmlFor={`markdown-content-${file.id}`}>Content</Label>
          <Textarea
            id={`markdown-content-${file.id}`}
            rows={7}
            spellCheck={false}
            value={file.content}
            onChange={(event) => update(file.id, { content: event.target.value })}
            className="font-mono text-xs"
          />
        </div>
      ))}
      <div className="space-y-3 border-t border-slate-200 dark:border-slate-700 pt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Label htmlFor="markdown-template">index.html template</Label>
          <div className="flex flex-wrap items-center gap-2">
            {customTemplate === null ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => onCustomTemplateChange(autoTemplate)}
              >
                Customize template
              </Button>
            ) : (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => onCustomTemplateChange(null)}
              >
                <RotateCcw className="size-3.5" /> Use generated template
              </Button>
            )}
          </div>
        </div>
        <Textarea
          id="markdown-template"
          rows={11}
          spellCheck={false}
          value={customTemplate ?? autoTemplate}
          readOnly={customTemplate === null}
          onChange={(event) => onCustomTemplateChange(event.target.value)}
          className="font-mono text-xs"
        />
        <Label
          htmlFor="markdown-template-file"
          className="text-xs text-slate-500 dark:text-slate-400"
        >
          Or load a custom HTML template
        </Label>
        <Input
          id="markdown-template-file"
          type="file"
          accept=".html,.htm,text/html"
          className="h-auto py-2 text-xs file:mr-2"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0]
            event.currentTarget.value = ''
            void importTemplate(file)
          }}
        />
        <p className="text-xs leading-5 text-slate-500 dark:text-slate-400">
          Each Markdown file needs a matching <code>{'{{ toHTML "filename.md" }}'}</code> call.
          Assets must be referenced by their filename, not a directory path.
        </p>
      </div>
    </section>
  )
}
