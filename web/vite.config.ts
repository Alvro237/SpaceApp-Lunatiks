/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import { defineConfig, type HtmlTagDescriptor, type Plugin } from 'vite'

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

/**
 * The navigator (the opening view of index.html) is a lazy chunk, so the text pages stay light. Without a hint the
 * browser learns about it and about the 3D engine only after it has fetched and run the entry script: three requests
 * one after another. This lists the navigator chunk and what it imports as modulepreload links in index.html, so
 * they travel in parallel with the entry script. The landing page is left alone.
 */
function preloadNavigator(): Plugin {
  return {
    name: 'preload-navigator',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        if (!ctx.filename.endsWith('index.html')) return []
        const chunks = Object.values(ctx.bundle ?? {}).filter((c) => c.type === 'chunk')
        const navigator = chunks.find((c) => c.isDynamicEntry && c.facadeModuleId?.endsWith('/app/NavigatorPage.tsx'))
        if (!navigator) return []
        const entries = new Set(chunks.filter((c) => c.isEntry).map((c) => c.fileName))
        // not the entry itself, nor a shared chunk the page already preloads
        const files = [navigator.fileName, ...navigator.imports].filter((f) => !entries.has(f) && !html.includes(f))
        return files.map((f): HtmlTagDescriptor => ({ tag: 'link', attrs: { rel: 'modulepreload', crossorigin: true, href: base + f }, injectTo: 'head' }))
      },
    },
  }
}

export default defineConfig({
  base,
  plugins: [react(), preloadNavigator()],
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
