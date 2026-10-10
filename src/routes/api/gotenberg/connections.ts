import { createFileRoute } from '@tanstack/react-router'
import { proxyConnectionsRequest, proxyErrorResponse } from '#/lib/gotenberg-proxy.server'

export const Route = createFileRoute('/api/gotenberg/connections')({
  server: {
    handlers: {
      GET: ({ request }) => {
        try {
          return proxyConnectionsRequest(request)
        } catch (error) {
          return proxyErrorResponse(error)
        }
      },
    },
  },
})
