import { createFileRoute, notFound } from '@tanstack/react-router'
import { OPERATION_BY_ID } from '#/tools/registry'

export const Route = createFileRoute('/_workspace/tools/$operationId')({
  beforeLoad: ({ params }) => {
    if (!OPERATION_BY_ID.has(params.operationId)) throw notFound()
  },
  component: () => null,
})
