import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

/**
 * Two ways to reach the API in development, and both work:
 *
 *  - `VITE_API_BASE_URL=/api` (see .env.example) sends requests to the Vite
 *    dev server, which proxies them below. Same-origin, so CORS never enters
 *    into it. This is how the source app was set up.
 *  - Leaving it unset falls back to the absolute `http://localhost:5001/api` in
 *    `src/api.ts`. Cross-origin, which works because `main.ts` enables CORS for
 *    `FRONTEND_URL`.
 *
 * The proxy target moved from 3001 to 5001 with the port: the source's Express
 * server listened on 3001, the Nest server listens on `PORT` (default 5001).
 */
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:5001',
        changeOrigin: true,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
