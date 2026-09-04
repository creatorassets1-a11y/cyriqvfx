/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * The frontend is built as a single-page app that the API serves in
 * production, so dev proxies everything the server owns (the API, the sitemap
 * and robots) to it and the browser only ever sees one origin. Cookies then
 * behave in development exactly as they do in production.
 */
export default defineConfig({
  plugins: [react()],

  server: {
    port: 5173,
    proxy: Object.fromEntries(
      ['/api', '/sitemap.xml', '/robots.txt'].map((path) => [
        path,
        { target: 'http://127.0.0.1:4000', changeOrigin: true },
      ]),
    ),
  },

  build: {
    target: 'es2020',
    cssCodeSplit: true,
    reportCompressedSize: false,
    rollupOptions: {
      output: {
        /**
         * Dependencies change far less often than the app does, so they live
         * in their own long-cached chunks. Everything else splits itself at
         * the route boundary through lazy(), which is what keeps the account
         * and admin code away from a visitor who never opens them.
         */
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('react-router') || id.includes('@remix-run')) return 'router';
          if (id.includes('/react-dom/') || id.includes('/react/')) return 'react';
          return undefined;
        },
      },
    },
  },

  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
