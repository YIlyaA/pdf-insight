import react from '@vitejs/plugin-react';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

// GitHub Pages serves the site under /<repo>/, so assets need this base.
export default defineConfig(({ mode }) => {
  // Without VITE_API_URL Vite folds the analysis code away and every upload fails at run time.
  if (mode === 'production' && !loadEnv(mode, process.cwd(), 'VITE_').VITE_API_URL) {
    throw new Error(
      'VITE_API_URL is required for a production build (the proxy address, not a secret).',
    );
  }
  return {
    base: '/pdf-insight/',
    plugins: [react()],
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./tests/setup.ts'],
      include: ['tests/**/*.test.{ts,tsx}'],
    },
  };
});
