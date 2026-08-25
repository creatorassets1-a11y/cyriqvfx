import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Dev proxy so the browser talks to one origin and cookies just work.
      '/api': { target: 'http://127.0.0.1:4000', changeOrigin: true },
      '/sitemap.xml': { target: 'http://127.0.0.1:4000', changeOrigin: true },
      '/robots.txt': { target: 'http://127.0.0.1:4000', changeOrigin: true },
    },
  },
  build: {
    target: 'es2020',
    cssCodeSplit: true,
    reportCompressedSize: false,
    rollupOptions: {
      output: {
        // Keep the vendor core in its own long-cached chunk; routes split
        // themselves via lazy() so first paint ships less JavaScript.
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          if (id.includes('react-router')) return 'router';
          if (id.includes('@tanstack')) return 'query';
          if (id.includes('react-dom') || id.includes('/react/')) return 'react';
        },
      },
    },
  },
});
