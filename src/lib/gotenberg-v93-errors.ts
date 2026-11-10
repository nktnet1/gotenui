import type { GotenbergVersion } from '#/lib/gotenberg-version'

/** Gotenberg does not expose its PDF flags through /version or /health.
 * Translate only diagnostic errors which prove a setting is active; never
 * infer that PDF processing is enabled just because the server reports v9.
 */
export function describePdfUpstreamError(
  version: GotenbergVersion,
  route: string,
  status: number,
  detail: string,
): string {
  if (version.major !== 9) return detail

  if (status === 404 && route.startsWith('/forms/pdf/')) {
    return `This Gotenberg instance does not expose ${route}. Check that PDF routes are enabled (PDF_DISABLE_ROUTES) and that the server supports this operation.`
  }

  if (version.minor < 3 || status !== 400) return detail

  if (
    (route.startsWith('/forms/chromium/convert/') || route === '/forms/libreoffice/convert') &&
    detail.includes("form field 'stages' is disabled on this instance")
  ) {
    return 'PDF post-processing is disabled for conversions on this Gotenberg instance (PDF_DISABLE_STAGES). Remove PDF processing stages and settings that require them, or ask the server administrator to enable stages.'
  }

  const pixels = /surface size out of bounds:\s*(\d{1,8})x(\d{1,8}) exceeds (\d{1,15}) pixels/.exec(
    detail,
  )
  if (route.startsWith('/forms/') && pixels) {
    return `Rendering this PDF page at ${pixels[1]} x ${pixels[2]} pixels exceeds the server limit of ${pixels[3]} pixels. Lower the render DPI or ask the server administrator to adjust PDF_MAX_RENDER_PIXELS.`
  }

  return detail
}
