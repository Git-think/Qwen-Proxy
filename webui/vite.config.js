import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'

// Read the version from the root package.json so the bundled webui
// reports the same version as the backend (single source of truth).
// Vite's `define` text-replaces the literal at build time, so the
// rendered webui doesn't need a runtime API call to display version.
const __dirname = dirname(fileURLToPath(import.meta.url))
const rootPkg = JSON.parse(readFileSync(resolve(__dirname, '../package.json'), 'utf-8'))

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(rootPkg.version || '0.0.0'),
  },
  server: {
    port: 5173,
    proxy: {
      '/v1': 'http://localhost:3000',
      '/api': 'http://localhost:3000',
      '/verify': 'http://localhost:3000',
      '/health': 'http://localhost:3000',
    }
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  }
})
