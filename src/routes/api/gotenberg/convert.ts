import { createFileRoute } from '@tanstack/react-router'
import { proxyConversionRequest, proxyErrorResponse } from '#/lib/gotenberg-proxy.server'

export const Route = createFileRoute('/api/gotenberg/convert')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          return await proxyConversionRequest(request)
        } catch (error) {
          return proxyErrorResponse(error)
        }
      },
    },
  },
})
