import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Point at the engine's source so a change there is picked up without a
      // rebuild step while iterating on the UI.
      '@apex/edit-engine': fileURLToPath(
        new URL('../../packages/edit-engine/src/index.ts', import.meta.url),
      ),
    },
  },
  server: { host: true, port: 5173 },
});
