/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// GitHub Pages serves the site under /<repo>/ (DP-01). The router is a HashRouter, so a reload on any
// route works without a 404.html copy.
const API = process.env.API_PROXY ?? 'http://127.0.0.1:8000'

export default defineConfig({
  base: '/SpaceApp-Lunatiks/',
  plugins: [react()],
  server: {
    // In development the API runs on its own port; the proxy avoids CORS and keeps paths relative.
    // API_PROXY overrides the target (for example when port 8000 is taken).
    proxy: { '/api': API, '/health': API },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    // every navigator test mounts the whole app (map, engine, panels); under parallel load 5 s is not enough
    testTimeout: 30_000,
    exclude: ['e2e/**', 'node_modules/**'],
  },
})
