import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/fantasy': 'http://localhost:8001',
      '/api': 'http://localhost:8001',
    },
  },
});
