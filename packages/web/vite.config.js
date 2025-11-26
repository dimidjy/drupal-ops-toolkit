import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// In development the API runs on its own port (dops serve); proxy /api to it.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://127.0.0.1:4800', ws: true },
    },
  },
});
