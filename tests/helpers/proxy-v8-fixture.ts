import { proxyConversionRequest as rawProxyConversionRequest } from '#/lib/gotenberg-proxy.server'

/** Legacy proxy-contract mocks provide conversion responses only. Intercept
 * the authenticated version probe so existing v8 response fixtures stay focused.
 */
export const proxyConversionRequest: typeof rawProxyConversionRequest = (
  request,
  fetcher = fetch,
) =>
  rawProxyConversionRequest(request, async (input, options) =>
    String(input).endsWith('/version') ? new Response('8.40.0') : fetcher(input, options),
  )
