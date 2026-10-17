import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// The browser reuses the server's phone and template rules, so previews and
// validation match exactly what the API will do.
const shared = fileURLToPath(new URL('../server/src/lib', import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@shared': shared } },
  server: {
    port: 5173,
    fs: { allow: ['..'] },
    proxy: {
      '/api': 'http://localhost:4000',
      '/webhooks': 'http://localhost:4000',
    },
  },
});
