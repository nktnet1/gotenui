import tailwindcss from '@tailwindcss/vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import react from '@vitejs/plugin-react'
import { nitro } from 'nitro/vite'
import { defineConfig } from 'vite'
import { vercelCommitSha } from '#/lib/app-version.ts'
import {
  filterBundledDependencyClientDirectives,
  labelDynamicChunkGroups,
} from '#scripts/nitro-build-warnings'

// The UI is an SPA shell, while Nitro serves same-origin serverless API routes.
export default defineConfig({
  // Only PUBLIC_ variables are embedded in client bundles. Keep secrets unprefixed.
  envPrefix: 'PUBLIC_',
  // Expose only the non-sensitive Vercel revision to client and prerendered HTML.
  define: {
    'import.meta.env.PUBLIC_GOTENUI_VERCEL_COMMIT_SHA': JSON.stringify(
      vercelCommitSha(process.env),
    ),
  },
  plugins: [
    tanstackStart({
      spa: { enabled: true, prerender: { outputPath: '/index.html' } },
    }),
    nitro({
      serverDir: './server',
      hooks: {
        'rollup:before'(_nitro, config) {
          // Nitro creates this group; do not replace its chunking strategy.
          labelDynamicChunkGroups(config.output)
          config.onLog = filterBundledDependencyClientDirectives(config.onLog)
        },
      },
    }),
    tailwindcss(),
    react(),
  ],
  resolve: { tsconfigPaths: true },
  server: { port: 3100, strictPort: true },
})
