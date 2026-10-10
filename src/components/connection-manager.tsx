import { type FormEvent, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import {
  type BrowserConnection,
  type ConnectionChoice,
  DEFAULT_CONNECTION_ID,
  type ManagedConnection,
  makeBrowserAuthorization,
  newBrowserConnection,
} from '#/lib/connection-profiles'
import { getGotenbergStatus } from '#/lib/gotenberg-client'

type Props = {
  browserProfiles: BrowserConnection[]
  managedProfiles: ManagedConnection[]
  selected: string
  onApply: (selected: string, username: string, secret: string) => void
  onUpsert: (profile: BrowserConnection, username: string, secret: string) => void
  onRemove: (id: string) => void
}

export function ConnectionManager({
  browserProfiles,
  managedProfiles,
  selected,
  onApply,
  onUpsert,
  onRemove,
}: Props) {
  const [draftId, setDraftId] = useState(selected)
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [mode, setMode] = useState<BrowserConnection['auth']>('none')
  const [username, setUsername] = useState('')
  const [secret, setSecret] = useState('')
  const [testing, setTesting] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [newProfile, setNewProfile] = useState(false)

  useEffect(() => {
    const profile = browserProfiles.find((item) => item.id === draftId)
    if (profile) {
      setName(profile.name)
      setUrl(profile.url)
      setMode(profile.auth)
    }
    setSecret('')
    setUsername('')
    setFeedback(null)
  }, [draftId, browserProfiles])

  const serverId = draftId.startsWith('server:') ? draftId.slice(7) : null
  const server = managedProfiles.find((profile) => profile.id === serverId)
  const existing = browserProfiles.find((profile) => profile.id === draftId)
  const isBrowser = newProfile || Boolean(existing)
  const canDelete = existing && existing.id !== DEFAULT_CONNECTION_ID

  const choose = (key: string) => {
    setNewProfile(false)
    setDraftId(key)
  }
  const add = () => {
    setNewProfile(true)
    setDraftId('new')
    setName('New Gotenberg')
    setUrl('')
    setMode('none')
    setUsername('')
    setSecret('')
    setFeedback(null)
  }
  const target = (): ConnectionChoice => {
    if (isBrowser) {
      return {
        kind: 'browser',
        url,
        authorization: makeBrowserAuthorization(mode, username, secret),
      }
    }
    if (!server) throw new Error('Select a connection.')
    return { kind: 'server', id: server.id }
  }
  const test = async () => {
    setTesting(true)
    setFeedback(null)
    try {
      const result = await getGotenbergStatus(target(), AbortSignal.timeout(8000))
      setFeedback(
        result.online
          ? `Connected to Gotenberg ${result.version}.`
          : (result.error ?? 'Unavailable'),
      )
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Connection test failed.')
    } finally {
      setTesting(false)
    }
  }
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    try {
      target()
      if (isBrowser) {
        onUpsert(
          newBrowserConnection(name, url, mode, newProfile ? undefined : existing?.id),
          username,
          secret,
        )
        setNewProfile(false)
      } else if (server) {
        onApply(`server:${server.id}`, '', '')
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save connection.')
    }
  }

  return (
    <form className="space-y-4" onSubmit={submit}>
      <div className="space-y-2">
        <Label htmlFor="connection-choice">Saved connections</Label>
        <div className="flex gap-2">
          <select
            id="connection-choice"
            value={draftId}
            onChange={(event) => choose(event.target.value)}
            className="h-10 min-w-0 flex-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 text-sm"
          >
            {browserProfiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.name} (browser)
              </option>
            ))}
            {managedProfiles.map((profile) => (
              <option key={profile.id} value={`server:${profile.id}`}>
                {profile.name} (server)
              </option>
            ))}
            {newProfile && <option value="new">New browser connection</option>}
          </select>
          <Button
            type="button"
            variant="outline"
            onClick={add}
            disabled={browserProfiles.length >= 20}
          >
            Add
          </Button>
        </div>
      </div>
      {isBrowser ? (
        <>
          <div className="space-y-2">
            <Label htmlFor="connection-name">Connection name</Label>
            <Input
              id="connection-name"
              value={name}
              maxLength={64}
              required
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="connection-url">Gotenberg URL</Label>
            <Input
              id="connection-url"
              type="url"
              spellCheck={false}
              value={url}
              required
              placeholder="https://pdf.example.com"
              onChange={(e) => setUrl(e.target.value)}
            />
            <p className="text-xs leading-5 text-slate-500 dark:text-slate-400">
              Only URLs approved by the server's <code>GOTENBERG_ALLOWED_URLS</code> can be used.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="connection-auth">Authentication</Label>
            <select
              id="connection-auth"
              className="h-10 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 text-sm"
              value={mode}
              onChange={(e) => {
                setMode(e.target.value as BrowserConnection['auth'])
                setSecret('')
              }}
            >
              <option value="none">None</option>
              <option value="basic">Basic Auth (enter each session)</option>
              <option value="bearer">Bearer token (enter each session)</option>
            </select>
          </div>
          {mode === 'basic' && (
            <div className="space-y-2">
              <Label htmlFor="connection-username">Username</Label>
              <Input
                id="connection-username"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>
          )}
          {mode !== 'none' && (
            <div className="space-y-2">
              <Label htmlFor="connection-secret">
                {mode === 'basic' ? 'Password' : 'Bearer token'}
              </Label>
              <Input
                id="connection-secret"
                type="password"
                autoComplete="off"
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
              />
              <p className="text-xs leading-5 text-slate-500 dark:text-slate-400">
                Credentials stay in this tab's memory, never in localStorage. Re-enter them after
                refreshing or switching connections.
              </p>
            </div>
          )}
        </>
      ) : server ? (
        <p className="rounded-lg bg-slate-50 dark:bg-slate-800/60 px-3 py-3 text-xs leading-5 text-slate-600 dark:text-slate-300">
          This connection is configured by the deployment. Its address and upstream credentials are
          not exposed to the browser. Anyone with access to Gotenui can use the configured
          credentials for this profile.
        </p>
      ) : (
        <p className="text-xs text-amber-700 dark:text-amber-300">
          This server connection is no longer available.
        </p>
      )}
      {feedback && (
        <p
          role="status"
          className="rounded-lg bg-slate-100 dark:bg-slate-800 px-3 py-3 text-xs text-slate-800 dark:text-slate-100"
        >
          {feedback}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={!isBrowser && !server}>
          {isBrowser ? 'Save and use' : 'Use connection'}
        </Button>
        <Button type="button" variant="accent" disabled={testing} onClick={() => void test()}>
          {testing ? 'Testing…' : 'Test connection'}
        </Button>
        {canDelete && existing && (
          <Button
            type="button"
            variant="destructive-outline"
            onClick={() => {
              onRemove(existing.id)
              choose(DEFAULT_CONNECTION_ID)
            }}
          >
            Remove
          </Button>
        )}
      </div>
      <p className="text-[11px] leading-5 text-slate-500 dark:text-slate-400">
        Gotenui uses a stateless server-side proxy. Browser profile names and URLs are saved
        locally; user-entered secrets stay in tab memory. Server-managed credentials remain in the
        deployment environment.
      </p>
    </form>
  )
}
