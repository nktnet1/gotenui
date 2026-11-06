import { Eye, EyeOff } from 'lucide-react'
import { useId, useState } from 'react'
import { Button } from '#/components/ui/button'

/** Only allow raster formats that the proxy verifies before returning a download. */
export function isPreviewableImage(type: string | undefined): boolean {
  return type === 'image/png' || type === 'image/jpeg' || type === 'image/webp'
}

/** Opt-in, browser-local preview using the already-retained download Blob URL. */
export function ImageResultPreview({ url, name }: { url: string; name: string }) {
  const [visible, setVisible] = useState(false)
  const regionId = useId()
  return (
    <div className="space-y-2">
      <Button
        type="button"
        size="sm"
        variant="outline"
        aria-expanded={visible}
        aria-controls={regionId}
        onClick={() => setVisible((current) => !current)}
      >
        {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        {visible ? 'Hide image preview' : 'Preview image'}
      </Button>
      <div id={regionId} hidden={!visible}>
        {visible && (
          <img
            src={url}
            alt={`Preview of ${name}`}
            decoding="async"
            className="max-h-72 w-full rounded-lg border border-slate-200 object-contain dark:border-slate-700"
          />
        )}
      </div>
    </div>
  )
}
