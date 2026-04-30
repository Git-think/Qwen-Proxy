import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
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
