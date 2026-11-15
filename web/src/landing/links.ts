/**
 * The landing page's outside links, in one place so the submission links are set in one edit.
 * An empty string hides the link (or shows a placeholder for the video).
 */

/** The navigator: '/app' on Vercel, the base path elsewhere (set in vite.config.ts). */
export const APP_URL: string = import.meta.env.VITE_APP_URL ?? import.meta.env.BASE_URL

/** YouTube id of the 30-second demo (the part after `v=` or after `youtu.be/`). When set it wins over the file. */
export const DEMO_YOUTUBE_ID = ''

/**
 * The demo as a file served with the site (web/public/media, kept out of git: copy demo.mp4 there before building).
 * DEMO_AI_NOTE is shown over the player at all times: the video contains AI-generated footage, and the Space Apps
 * rules ask for a visible mark on AI images and video.
 */
export const DEMO_VIDEO = `${import.meta.env.BASE_URL}media/demo.mp4`
export const DEMO_POSTER = `${import.meta.env.BASE_URL}media/demo-poster.jpg`
export const DEMO_AI_NOTE = 'Contains AI-generated footage'

/** A real screenshot of the navigator on a 390 x 844 phone window (the production site, 2026-11-15). */
export const PHONE_SCREENSHOT = `${import.meta.env.BASE_URL}media/app-phone.jpg`

/** Public API documentation (FastAPI /docs of the deployed API). */
export const API_DOCS_URL: string =
  import.meta.env.VITE_API_DOCS_URL ?? (import.meta.env.VITE_API_URL ? `${String(import.meta.env.VITE_API_URL).replace(/\/$/, '')}/docs` : '')

/** Public source repository. Leave empty while the repository is private. */
export const REPO_URL = ''

/**
 * Optional scroll-driven background video (for example one made with an AI video tool), served from web/public.
 * When set it replaces the rendered Moon and the page shows a visible "AI-generated" watermark, as the Space Apps
 * rules require for AI images and video. Empty: the background is rendered live from NASA LROC imagery.
 */
export const BACKGROUND_VIDEO = ''
export const BACKGROUND_VIDEO_CREDIT = 'AI-generated background video (Higgsfield)'
