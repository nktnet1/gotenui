import { createFileRoute } from '@tanstack/react-router'
import { proxyDebugRequest, proxyErrorResponse } from '#/lib/gotenberg-proxy.server'

export const Route = createFileRoute('/api/gotenberg/debug')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          return await proxyDebugRequest(request)
        } catch (error) {
          return proxyErrorResponse(error)
        }
      },
    },
  },
})
