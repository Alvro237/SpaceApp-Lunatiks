/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// GitHub Pages serves the site under /<repo>/ (DP-01). The router is a HashRouter, so a reload on any
// route works without a 404.html copy.
const API = process.env.API_PROXY ?? 'http://127.0.0.1:8000'

export default defineConfig({
  base: '/SpaceApp-Lunatiks/',
  plugins: [react()],
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
