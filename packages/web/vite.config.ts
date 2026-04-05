import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const apiTarget = process.env.VITE_API_URL ?? 'http://localhost:3000';
const wsTarget  = process.env.VITE_API_URL
  ? process.env.VITE_API_URL.replace(/^http/, 'ws')
  : 'ws://localhost:3000';

export default defineConfig({
  plugins: [tailwindcss(), react()],
  server: {
    proxy: {
      '/api': apiTarget,
      '/ws': { target: wsTarget, ws: true }
    }
  }
});
