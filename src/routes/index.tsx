import { createFileRoute } from '@tanstack/react-router'
import { GotenuiApp } from '#/components/gotenui-app'

export const Route = createFileRoute('/')({
  component: GotenuiApp,
})
