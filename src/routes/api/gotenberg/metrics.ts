import { createFileRoute } from '@tanstack/react-router'
import { proxyErrorResponse, proxyMetricsRequest } from '#/lib/gotenberg-proxy.server'

export const Route = createFileRoute('/api/gotenberg/metrics')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          return await proxyMetricsRequest(request)
        } catch (error) {
          return proxyErrorResponse(error)
        }
      },
    },
  },
})
