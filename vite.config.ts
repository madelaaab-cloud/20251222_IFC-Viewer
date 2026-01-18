import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: '/20251222_IFC-Viewer/',
  plugins: [react()],
  server: {
    port: 5173,
    host: true
  }
});
