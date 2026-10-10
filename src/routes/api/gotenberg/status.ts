import { createFileRoute } from '@tanstack/react-router'
import { proxyErrorResponse, proxyStatusRequest } from '../../../lib/gotenberg-proxy.server'

export const Route = createFileRoute('/api/gotenberg/status')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          return await proxyStatusRequest(request)
        } catch (error) {
          return proxyErrorResponse(error)
        }
      },
    },
  },
})
