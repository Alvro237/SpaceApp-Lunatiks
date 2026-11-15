/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'

// GitHub Pages serves the site under /<repo>/ (DP-01). The router is a HashRouter, so a reload on any
// route works without a 404.html copy.
const API = process.env.API_PROXY ?? 'http://127.0.0.1:8000'

// Vercel (build with VERCEL=1, see deploy/vercel) serves everything from one domain: the landing page at /, the
// navigator at /app and the API at /api and /docs. BASE_PATH overrides the base for any other host.
const onVercel = Boolean(process.env.VERCEL)
const base = process.env.BASE_PATH ?? (onVercel ? '/' : '/SpaceApp-Lunatiks/')
// Where the landing page's buttons go. Vite exposes VITE_* variables of process.env to the code.
process.env.VITE_APP_URL ??= onVercel ? '/app' : base
if (onVercel) process.env.VITE_API_DOCS_URL ??= '/docs'

export default defineConfig({
  base,
  plugins: [react()],
  build: {
    // two pages: the navigator (index.html) and the landing page (landing.html)
    rollupOptions: { input: { main: resolve(import.meta.dirname, 'index.html'), landing: resolve(import.meta.dirname, 'landing.html') } },
  },
  // ES module workers, so the decode worker can load geotiff.js on demand (live terrain levels)
  worker: { format: 'es' },
  server: {
    // In development the API runs on its own port; the proxy avoids CORS and keeps paths relative.
    // API_PROXY overrides the target (for example when port 8000 is taken).
    // /pgda/ stands for https://pgda.gsfc.nasa.gov/data/ (live terrain levels, src/terrain/live): PGDA sends no
    // CORS header, so development goes through this proxy and production through src/proxy/pgdaProxy.ts.
    proxy: {
      '/api': API,
      '/health': API,
      '/pgda/': { target: 'https://pgda.gsfc.nasa.gov', changeOrigin: true, rewrite: (p) => p.replace(/^\/pgda\//, '/data/') },
    },
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
