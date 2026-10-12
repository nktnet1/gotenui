import { createCsrfMiddleware, createMiddleware, createStart } from '@tanstack/react-start'
import { appBasicAuthChallenge } from '#/lib/app-basic-auth.server'

const basicAuthMiddleware = createMiddleware().server(({ next, request }) => {
  const challenge = appBasicAuthChallenge(request.headers.get('authorization'))
  return challenge ?? next()
})

export const startInstance = createStart(() => ({
  requestMiddleware: [
    basicAuthMiddleware,
    createCsrfMiddleware({ filter: ({ handlerType }) => handlerType === 'serverFn' }),
  ],
}))
