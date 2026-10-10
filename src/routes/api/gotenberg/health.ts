import { createFileRoute } from '@tanstack/react-router'
import { proxyHeadErrorResponse, proxyHeadHealthRequest } from '#/lib/gotenberg-proxy.server'

export const Route = createFileRoute('/api/gotenberg/health')({
  server: {
    handlers: {
      HEAD: async ({ request }) => {
        try {
          return await proxyHeadHealthRequest(request)
        } catch (error) {
          return proxyHeadErrorResponse(error)
        }
      },
    },
  },
})
