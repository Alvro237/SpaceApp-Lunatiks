/**
 * The landing page's outside links, in one place so the submission links are set in one edit.
 * An empty string hides the link (or shows a placeholder for the video).
 */

/** The navigator: '/app' on Vercel, the base path elsewhere (set in vite.config.ts). */
export const APP_URL: string = import.meta.env.VITE_APP_URL ?? import.meta.env.BASE_URL

/** YouTube id of the 30-second demo (the part after `v=` or after `youtu.be/`). */
export const DEMO_YOUTUBE_ID = ''

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
