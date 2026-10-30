import { createMemoryHistory, createRouter } from '@tanstack/react-router'
import { describe, expect, it } from 'vitest'
import { OPERATION_BY_ID, OPERATIONS } from '#/lib/operations'
import { getRouter } from '#/router'
import { routeTree } from '#/routeTree.gen'

describe('TanStack Start tool routes', () => {
  it('generates unique, typed links from the shared operation registry', () => {
    const router = getRouter()
    const paths = OPERATIONS.map(
      ({ id }) =>
        router.buildLocation({ to: '/tools/$operationId', params: { operationId: id } }).pathname,
    )
    expect(new Set(paths).size).toBe(OPERATIONS.length)
    expect(router.buildLocation({ to: '/' }).pathname).toBe('/')
    for (const [index, operation] of OPERATIONS.entries()) {
      expect(paths[index]).toBe(`/tools/${operation.id}`)
    }
  })

  it('matches deep links using a persistent workspace layout', () => {
    const router = getRouter()
    expect(router.matchRoutes('/').map((match) => match.routeId)).toEqual([
      '__root__',
      '/_workspace',
      '/_workspace/',
    ])
    for (const operation of OPERATIONS) {
      const path = router.buildLocation({
        to: '/tools/$operationId',
        params: { operationId: operation.id },
      }).pathname
      const matches = router.matchRoutes(path)
      expect(matches.map((match) => match.routeId)).toEqual([
        '__root__',
        '/_workspace',
        '/_workspace/tools/$operationId',
      ])
      expect(matches.at(-1)?.params).toMatchObject({ operationId: operation.id })
    }
  })

  it('resolves the bookmarked tool again after a full router reload', async () => {
    const path = '/tools/metadata-read'
    for (let reload = 0; reload < 2; reload++) {
      const history = createMemoryHistory({ initialEntries: [path] })
      const router = createRouter({ routeTree, history })
      await router.load()
      expect(router.state.location.pathname).toBe(path)
      expect(router.state.matches.at(-1)?.params).toMatchObject({ operationId: 'metadata-read' })
    }
  })

  it('uses the same operation registry to validate tool identifiers', () => {
    expect(OPERATION_BY_ID.has('home')).toBe(false)
    expect(OPERATION_BY_ID.has('not-an-operation')).toBe(false)
    expect(routerMatch('/api/gotenberg/status')).not.toContain('/_workspace/tools/$operationId')
  })
})

function routerMatch(path: string) {
  return getRouter()
    .matchRoutes(path)
    .map((match) => match.routeId)
}
