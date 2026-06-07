import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const API_PORT = process.env.VITE_API_PORT || '8001';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/fantasy': `http://localhost:${API_PORT}`,
    },
  },
});
