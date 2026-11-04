/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Worker base URL; empty or missing means the app shows "not configured". */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
