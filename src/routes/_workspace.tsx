import { createFileRoute, Outlet, useNavigate, useRouterState } from '@tanstack/react-router'
import { useCallback } from 'react'
import { GotenuiApp } from '#/components/gotenui-app'
import { OPERATION_BY_ID } from '#/lib/operations'

export const Route = createFileRoute('/_workspace')({
  component: WorkspaceRoute,
})

/** Keep the workspace mounted while the file-based child route selects the active tool. */
function WorkspaceRoute() {
  const selectedId = useRouterState({
    select: (state) => {
      const params = state.matches.at(-1)?.params
      const id = params && 'operationId' in params ? params.operationId : undefined
      return typeof id === 'string' && OPERATION_BY_ID.has(id) ? id : 'home'
    },
  })
  const navigate = useNavigate()
  const onSelect = useCallback(
    (id: string) => {
      if (id === selectedId) return
      if (id === 'home') {
        void navigate({ to: '/' })
      } else {
        if (!OPERATION_BY_ID.has(id)) throw new Error(`Unknown tool: ${id}`)
        void navigate({ to: '/tools/$operationId', params: { operationId: id } })
      }
    },
    [navigate, selectedId],
  )

  return (
    <>
      <GotenuiApp selectedId={selectedId} onSelect={onSelect} />
      <Outlet />
    </>
  )
}
