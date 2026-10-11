import { defineMiddleware } from 'nitro'
import { appBasicAuthChallenge } from '../../src/lib/app-basic-auth.server'

// Runs before TanStack UI and API routes (Nitro serves public static assets separately).
export default defineMiddleware((event) =>
  appBasicAuthChallenge(event.req.headers.get('authorization')),
)
