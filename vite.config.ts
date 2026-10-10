import tailwindcss from '@tailwindcss/vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import react from '@vitejs/plugin-react'
import { nitro } from 'nitro/vite'
import { defineConfig } from 'vite'
import {
  filterBundledDependencyClientDirectives,
  labelDynamicChunkGroups,
} from '#scripts/nitro-build-warnings'

// The UI is an SPA shell, while Nitro serves same-origin serverless API routes.
export default defineConfig({
  plugins: [
    tanstackStart({
      spa: { enabled: true, prerender: { outputPath: '/index.html' } },
    }),
    nitro({
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
