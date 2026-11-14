import { defineConfig } from '@playwright/test'

/**
 * End-to-end checks in a real browser (plan: "Playwright con axe"): WebGL rendering of the terrain, keyboard
 * control of the map and playback, and axe-core including colour contrast, in both colour schemes.
 * Needs the API on API_URL (default http://127.0.0.1:8000) or runs against static data only.
 */
const PORT = Number(process.env.WEB_PORT ?? 5199)

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  use: {
    baseURL: `http://localhost:${PORT}/SpaceApp-Lunatiks/`,
    viewport: { width: 1440, height: 900 },
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
  },
  webServer: {
    command: `npm run dev -- --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/SpaceApp-Lunatiks/`,
    reuseExistingServer: true,
    env: { API_PROXY: process.env.API_URL ?? 'http://127.0.0.1:8000' },
  },
})
