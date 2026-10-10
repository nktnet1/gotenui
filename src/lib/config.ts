import * as v from 'valibot'
import { normalizeBackendUrl } from '#/lib/backend-url'

// Entirely public, build-time configuration: never store passwords or tokens here.
const buildEnvSchema = v.object({
  VITE_GOTENBERG_DEFAULT_URL: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(2048))),
})

const buildEnv = v.parse(buildEnvSchema, import.meta.env)
export const DEFAULT_BACKEND_URL = buildEnv.VITE_GOTENBERG_DEFAULT_URL
  ? normalizeBackendUrl(buildEnv.VITE_GOTENBERG_DEFAULT_URL)
  : 'https://demo.gotenberg.dev'
