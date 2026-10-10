import { Plus, Trash2 } from 'lucide-react'
import { useId } from 'react'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import { Switch } from '#/components/ui/switch'
import type { ChromiumCookie, ChromiumResourceHeader } from '#/lib/chromium-network'

export type CookieRow = ChromiumCookie & { id: number }
export type HeaderRow = ChromiumResourceHeader & { id: number }

export function ChromiumNetworkEditor({
  cookies,
  onCookiesChange,
  headers,
  onHeadersChange,
  newId,
}: {
  cookies: CookieRow[]
  onCookiesChange: (cookies: CookieRow[]) => void
  headers: HeaderRow[]
  onHeadersChange: (headers: HeaderRow[]) => void
  newId: () => number
}) {
  const id = useId()
  const updateCookie = (index: number, changes: Partial<ChromiumCookie>) =>
    onCookiesChange(cookies.map((item, i) => (i === index ? { ...item, ...changes } : item)))
  const updateHeader = (index: number, changes: Partial<ChromiumResourceHeader>) =>
    onHeadersChange(headers.map((item, i) => (i === index ? { ...item, ...changes } : item)))

  return (
    <section className="space-y-5 rounded-lg border border-slate-200 bg-white p-4">
      <div>
        <h3 className="text-sm font-semibold text-slate-800">Chromium website authentication</h3>
        <p className="mt-1 text-xs leading-5 text-slate-500">
          Optional cookies and resource headers are sent by Chromium to the pages and assets it
          loads, not as HTTP headers from the browser to Gotenberg. Gotenberg controls outbound URL
          access. Keep credentials scoped to the intended host and use HTTPS.
        </p>
      </div>
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-semibold text-slate-700">Cookies ({cookies.length}/20)</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={cookies.length >= 20}
            onClick={() =>
              onCookiesChange([
                ...cookies,
                {
                  id: newId(),
                  name: '',
                  value: '',
                  domain: '',
                  path: '/',
                  secure: true,
                  httpOnly: true,
                  sameSite: 'Lax',
                },
              ])
            }
          >
            <Plus className="size-3.5" /> Add cookie
          </Button>
        </div>
        {cookies.map((cookie, index) => (
          <div
            key={cookie.id}
            className="space-y-3 rounded-lg border border-slate-200 bg-slate-50/50 p-3"
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor={`${id}-cookie-name-${index}`}>Name</Label>
                <Input
                  id={`${id}-cookie-name-${index}`}
                  value={cookie.name}
                  onChange={(event) => updateCookie(index, { name: event.target.value })}
                  autoComplete="off"
                  placeholder="session"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`${id}-cookie-value-${index}`}>Value</Label>
                <Input
                  id={`${id}-cookie-value-${index}`}
                  type="password"
                  value={cookie.value}
                  onChange={(event) => updateCookie(index, { value: event.target.value })}
                  autoComplete="new-password"
                  placeholder="Cookie value"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`${id}-cookie-domain-${index}`}>Domain (host only)</Label>
                <Input
                  id={`${id}-cookie-domain-${index}`}
                  value={cookie.domain}
                  onChange={(event) => updateCookie(index, { domain: event.target.value })}
                  placeholder="portal.example.com"
                  autoComplete="off"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`${id}-cookie-path-${index}`}>Path</Label>
                <Input
                  id={`${id}-cookie-path-${index}`}
                  value={cookie.path}
                  onChange={(event) => updateCookie(index, { path: event.target.value })}
                  placeholder="/"
                />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2">
                <Switch
                  id={`${id}-cookie-secure-${index}`}
                  checked={cookie.secure}
                  onCheckedChange={(value) => updateCookie(index, { secure: value })}
                />
                <Label htmlFor={`${id}-cookie-secure-${index}`}>HTTPS only</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  id={`${id}-cookie-http-${index}`}
                  checked={cookie.httpOnly}
                  onCheckedChange={(value) => updateCookie(index, { httpOnly: value })}
                />
                <Label htmlFor={`${id}-cookie-http-${index}`}>HTTP only</Label>
              </div>
              <label className="flex items-center gap-2 text-xs text-slate-600">
                SameSite
                <select
                  aria-label={`Cookie ${index + 1} SameSite`}
                  className="rounded-md border border-slate-200 bg-white px-2 py-1"
                  value={cookie.sameSite}
                  onChange={(event) =>
                    updateCookie(index, {
                      sameSite: event.target.value as ChromiumCookie['sameSite'],
                    })
                  }
                >
                  <option value="">Browser default</option>
                  <option value="Lax">Lax</option>
                  <option value="Strict">Strict</option>
                  <option value="None">None</option>
                </select>
              </label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="ml-auto"
                onClick={() => onCookiesChange(cookies.filter((_, i) => i !== index))}
              >
                <Trash2 className="size-3.5" /> Remove
              </Button>
            </div>
          </div>
        ))}
      </div>
      <div className="space-y-3 border-t border-slate-100 pt-4">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-semibold text-slate-700">
            Resource headers ({headers.length}/20)
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={headers.length >= 20}
            onClick={() =>
              onHeadersChange([...headers, { id: newId(), name: '', value: '', scope: '' }])
            }
          >
            <Plus className="size-3.5" /> Add header
          </Button>
        </div>
        <p className="text-xs leading-5 text-slate-500">
          Each header needs an explicit URL-matching regular expression. For example,
          <code className="ml-1 rounded bg-slate-100 px-1">^https://portal\.example\.com/</code>.
          This avoids accidentally sending tokens to third-party fonts, scripts, or images. Do not
          put credentials in an unscoped Advanced JSON field.
        </p>
        {headers.map((header, index) => (
          <div
            key={header.id}
            className="space-y-3 rounded-lg border border-slate-200 bg-slate-50/50 p-3"
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor={`${id}-header-name-${index}`}>Header name</Label>
                <Input
                  id={`${id}-header-name-${index}`}
                  value={header.name}
                  onChange={(event) => updateHeader(index, { name: event.target.value })}
                  placeholder="Authorization"
                  autoComplete="off"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`${id}-header-value-${index}`}>Header value</Label>
                <Input
                  id={`${id}-header-value-${index}`}
                  type="password"
                  value={header.value}
                  onChange={(event) => updateHeader(index, { value: event.target.value })}
                  placeholder="Bearer …"
                  autoComplete="new-password"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${id}-header-scope-${index}`}>URL scope (regular expression)</Label>
              <Input
                id={`${id}-header-scope-${index}`}
                value={header.scope}
                onChange={(event) => updateHeader(index, { scope: event.target.value })}
                placeholder="^https://portal\.example\.com/"
                autoComplete="off"
              />
            </div>
            <div className="flex justify-end">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onHeadersChange(headers.filter((_, i) => i !== index))}
              >
                <Trash2 className="size-3.5" /> Remove
              </Button>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
