import { fileURLToPath } from 'node:url'

/**
 * Use the Node package imports map for project modules. Vite's explicit alias
 * gives its browser and SSR module graphs the same #/ resolution semantics.
 */
export const sourceAliases = {
  '#/': fileURLToPath(new URL('../src/', import.meta.url)),
}
