import { ArrowDown, ArrowUp, Code2, ListTree, Plus, Trash2 } from 'lucide-react'
import { useId, useState } from 'react'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import { Textarea } from '#/components/ui/textarea'
import {
  addBookmarkMapping,
  type BookmarkEdit,
  type BookmarkNode,
  editBookmarks,
  editFileBookmarks,
  METADATA_TEXT_FIELDS,
  type MetadataKey,
  metadataObject,
  removeBookmarkMapping,
  updateMetadata,
  validateBookmarkDocument,
  visualBookmarkList,
  visualBookmarkMap,
  visualMetadataValue,
} from '#/lib/pdf-structure-editors'

type EditorProps = {
  value: string
  onChange: (value: string) => void
}

function EditorMode({
  mode,
  onChange,
  id,
}: {
  mode: 'visual' | 'json'
  onChange: (mode: 'visual' | 'json') => void
  id: string
}) {
  return (
    <fieldset aria-label="Editing mode" className="flex min-w-0 gap-2 border-0 p-0">
      {(['visual', 'json'] as const).map((choice) => (
        <Button
          key={choice}
          type="button"
          size="sm"
          variant={mode === choice ? 'accent' : 'outline'}
          aria-pressed={mode === choice}
          aria-controls={id}
          onClick={() => onChange(choice)}
        >
          {choice === 'visual' ? <ListTree className="size-4" /> : <Code2 className="size-4" />}
          {choice === 'visual' ? 'Visual editor' : 'JSON editor'}
        </Button>
      ))}
    </fieldset>
  )
}

export function PdfMetadataEditor({ value, onChange }: EditorProps) {
  const [mode, setMode] = useState<'visual' | 'json'>('visual')
  // Keep a comma or trailing whitespace visible while users type a keyword list.
  const [keywordDraft, setKeywordDraft] = useState<string | null>(null)
  const id = useId()
  let metadata: Record<string, unknown> | null = null
  try {
    metadata = metadataObject(value)
  } catch {
    // Preserve invalid user-authored JSON; repairing it must not discard input.
  }
  const unsupported =
    metadata &&
    [...METADATA_TEXT_FIELDS.map(({ name }) => name), 'Keywords'].some(
      (name) => visualMetadataValue(metadata, name as MetadataKey) === null,
    )
  const visualReady = metadata !== null && !unsupported
  return (
    <section className="space-y-4 rounded-xl border border-slate-200 bg-slate-50/60 p-4 dark:border-slate-700 dark:bg-slate-800/40">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">PDF metadata</h3>
          <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">
            Common XMP tags. Other tags remain available in the JSON editor.
          </p>
        </div>
        <EditorMode
          mode={mode}
          onChange={(nextMode) => {
            setKeywordDraft(null)
            setMode(nextMode)
          }}
          id={id}
        />
      </div>
      <div id={id} className="space-y-4">
        {mode === 'json' ? (
          <div className="space-y-2">
            <Label htmlFor={`${id}-raw`}>Metadata JSON</Label>
            <Textarea
              id={`${id}-raw`}
              value={value}
              rows={7}
              spellCheck={false}
              className="font-mono text-xs"
              onChange={(event) => onChange(event.target.value)}
              required
            />
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Use JSON for uncommon XMP tags and non-text values. Existing fields are never removed
              by changing modes.
            </p>
          </div>
        ) : !visualReady ? (
          <p
            role="status"
            className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
          >
            This metadata contains invalid JSON or a non-text value in a common field. Open the JSON
            editor to repair it. Nothing has been discarded.
          </p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {METADATA_TEXT_FIELDS.map(({ name, label, placeholder }) => (
              <div className="space-y-1.5" key={name}>
                <Label htmlFor={`${id}-${name}`}>{label}</Label>
                <Input
                  id={`${id}-${name}`}
                  value={visualMetadataValue(metadata ?? {}, name) ?? ''}
                  maxLength={500}
                  placeholder={placeholder}
                  onChange={(event) => onChange(updateMetadata(value, name, event.target.value))}
                />
              </div>
            ))}
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor={`${id}-keywords`}>Keywords</Label>
              <Input
                id={`${id}-keywords`}
                value={keywordDraft ?? visualMetadataValue(metadata ?? {}, 'Keywords') ?? ''}
                maxLength={1200}
                placeholder="invoice, accounts, 2026"
                onChange={(event) => {
                  setKeywordDraft(event.target.value)
                  onChange(updateMetadata(value, 'Keywords', event.target.value))
                }}
                onBlur={() => setKeywordDraft(null)}
              />
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Separate keywords with commas. Gotenberg receives them as a JSON string list.
              </p>
            </div>
          </div>
        )}
      </div>
    </section>
  )
}

function BookmarkItems({
  items,
  parent,
  onEdit,
}: {
  items: BookmarkNode[]
  parent: number[]
  onEdit: (edit: BookmarkEdit) => void
}) {
  const id = useId()
  return (
    <ol className="space-y-3">
      {items.map((item, index) => {
        const path = [...parent, index]
        const label = `Bookmark ${path.map((i) => i + 1).join('.')}`
        const pageInvalid = !Number.isSafeInteger(item.page) || Number(item.page) < 1
        return (
          <li
            key={path.join('-')}
            className="space-y-3 rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900"
          >
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-40 flex-[2] space-y-1.5">
                <Label htmlFor={`${id}-${index}-title`}>{label} title</Label>
                <Input
                  id={`${id}-${index}-title`}
                  value={item.title}
                  maxLength={300}
                  aria-invalid={!item.title.trim()}
                  onChange={(event) =>
                    onEdit({ kind: 'update', path, field: 'title', value: event.target.value })
                  }
                />
              </div>
              <div className="w-28 space-y-1.5">
                <Label htmlFor={`${id}-${index}-page`}>Page</Label>
                <Input
                  id={`${id}-${index}-page`}
                  type="text"
                  inputMode="numeric"
                  value={String(item.page)}
                  aria-invalid={pageInvalid}
                  onChange={(event) =>
                    onEdit({ kind: 'update', path, field: 'page', value: event.target.value })
                  }
                />
              </div>
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  aria-label={`Move ${label} up`}
                  title="Move up"
                  disabled={index === 0}
                  onClick={() => onEdit({ kind: 'move', path, direction: -1 })}
                >
                  <ArrowUp className="size-4" />
                </Button>
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  aria-label={`Move ${label} down`}
                  title="Move down"
                  disabled={index === items.length - 1}
                  onClick={() => onEdit({ kind: 'move', path, direction: 1 })}
                >
                  <ArrowDown className="size-4" />
                </Button>
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  aria-label={`Remove ${label}`}
                  title="Remove bookmark and its children"
                  onClick={() => onEdit({ kind: 'remove', path })}
                >
                  <Trash2 className="size-4 text-rose-600 dark:text-rose-400" />
                </Button>
              </div>
            </div>
            {pageInvalid && (
              <p className="text-xs text-rose-700 dark:text-rose-300">
                Enter a positive whole-number page, starting at 1.
              </p>
            )}
            {!item.title.trim() && (
              <p className="text-xs text-rose-700 dark:text-rose-300">Enter a bookmark title.</p>
            )}
            {item.children.length > 0 && (
              <div className="ml-2 space-y-2 border-l-2 border-sky-200 pl-3 dark:border-sky-800">
                <BookmarkItems items={item.children} parent={path} onEdit={onEdit} />
              </div>
            )}
            {path.length < 8 && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => onEdit({ kind: 'add', parent: path })}
              >
                <Plus className="size-4" /> Add child
              </Button>
            )}
          </li>
        )
      })}
    </ol>
  )
}

export function PdfBookmarksEditor({
  value,
  onChange,
  filenames = [],
  allowFilenameMap = false,
}: EditorProps & { filenames?: string[]; allowFilenameMap?: boolean }) {
  const [mode, setMode] = useState<'visual' | 'json'>('visual')
  const [selectedFilename, setSelectedFilename] = useState('')
  const [newFilename, setNewFilename] = useState('')
  const [editError, setEditError] = useState<string | null>(null)
  const id = useId()
  const mapped = visualBookmarkMap(value)
  const filename =
    mapped && Object.hasOwn(mapped, selectedFilename)
      ? selectedFilename
      : mapped
        ? Object.keys(mapped)[0]
        : undefined
  const items = mapped
    ? allowFilenameMap && filename
      ? (mapped[filename] ?? null)
      : null
    : visualBookmarkList(value)
  let warning: string | null = null
  try {
    validateBookmarkDocument(value)
  } catch (error) {
    warning = error instanceof Error ? error.message : 'Invalid bookmark data.'
  }
  const edit = (change: BookmarkEdit) => {
    try {
      const next =
        mapped && filename
          ? editFileBookmarks(value, filename, change)
          : editBookmarks(value, change)
      onChange(next)
      setEditError(null)
    } catch (error) {
      setEditError(error instanceof Error ? error.message : 'Could not edit bookmarks.')
    }
  }
  const addMapping = () => {
    try {
      const name = newFilename.trim()
      const next = addBookmarkMapping(value, name)
      onChange(next)
      setSelectedFilename(name)
      setNewFilename('')
      setEditError(null)
    } catch (error) {
      setEditError(error instanceof Error ? error.message : 'Could not add filename.')
    }
  }
  return (
    <section className="space-y-4 rounded-xl border border-slate-200 bg-slate-50/60 p-4 dark:border-slate-700 dark:bg-slate-800/40">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">PDF bookmarks</h3>
          <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">
            Add and reorder outlines. Pages are 1-based. Filename-specific pages are relative to
            each input and Gotenberg offsets them when merging.
          </p>
        </div>
        <EditorMode mode={mode} onChange={setMode} id={id} />
      </div>
      <div id={id} className="space-y-3">
        {mode === 'json' ? (
          <div className="space-y-2">
            <Label htmlFor={`${id}-raw`}>Bookmarks JSON</Label>
            <Textarea
              id={`${id}-raw`}
              value={value}
              rows={9}
              spellCheck={false}
              className="font-mono text-xs"
              onChange={(event) => onChange(event.target.value)}
              required
            />
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Use JSON for advanced bookmarks. A list applies to the final document; a
              filename-keyed map has per-file page offsets.
            </p>
          </div>
        ) : (
          <>
            {allowFilenameMap && (
              <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
                {mapped ? (
                  <>
                    <div className="flex flex-wrap items-end gap-2">
                      <div className="min-w-40 flex-1 space-y-1.5">
                        <Label htmlFor={`${id}-file`}>Bookmarks for PDF</Label>
                        <select
                          id={`${id}-file`}
                          value={filename}
                          onChange={(event) => setSelectedFilename(event.target.value)}
                          className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-800"
                        >
                          {Object.keys(mapped).map((name) => (
                            <option key={name} value={name}>
                              {name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={!filename}
                        onClick={() => {
                          if (filename) {
                            onChange(removeBookmarkMapping(value, filename))
                            setSelectedFilename('')
                          }
                        }}
                      >
                        <Trash2 className="size-4" /> Remove mapping
                      </Button>
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Filenames must match their uploaded PDFs or a remote PDF's download filename.
                      All other files retain their original bookmarks when auto-indexing is enabled.
                    </p>
                  </>
                ) : (
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Shared bookmark tree for the{' '}
                    {filenames.length > 1 ? 'combined output' : 'selected PDFs'}. To edit bookmarks
                    per PDF, first clear this shared tree.
                  </p>
                )}
                {(mapped || items?.length === 0) && (
                  <div className="flex flex-wrap items-end gap-2">
                    <div className="min-w-40 flex-1 space-y-1.5">
                      <Label htmlFor={`${id}-new-file`}>Add filename mapping</Label>
                      <Input
                        id={`${id}-new-file`}
                        value={newFilename}
                        list={`${id}-known-files`}
                        placeholder="report.pdf"
                        onChange={(event) => setNewFilename(event.target.value)}
                      />
                      <datalist id={`${id}-known-files`}>
                        {filenames
                          .filter((name) => !mapped || !Object.hasOwn(mapped, name))
                          .map((name) => (
                            <option key={name} value={name} />
                          ))}
                      </datalist>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={!newFilename.trim()}
                      onClick={addMapping}
                    >
                      <Plus className="size-4" /> Add PDF
                    </Button>
                  </div>
                )}
              </div>
            )}
            {items === null ? (
              <p
                role="status"
                className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
              >
                This is a filename map, invalid JSON, or a tree too deep for this editor. Switch to
                JSON mode to edit without losing any entries.
              </p>
            ) : (
              <>
                <BookmarkItems items={items} parent={[]} onEdit={edit} />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => edit({ kind: 'add', parent: [] })}
                >
                  <Plus className="size-4" /> Add top-level bookmark
                </Button>
              </>
            )}
          </>
        )}
        {(warning || editError) && (
          <p role="status" className="text-xs text-rose-700 dark:text-rose-300">
            {editError ?? warning}
          </p>
        )}
      </div>
    </section>
  )
}
