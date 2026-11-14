/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the FastAPI backend. Empty in development (the Vite proxy forwards /api). */
  readonly VITE_API_URL?: string
}
