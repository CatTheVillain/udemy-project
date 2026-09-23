import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteAliases } from './config/vite-aliases';

// https://vitejs.dev/config/
export default defineConfig({
  ...(process.env.VITE_QA_CACHE_DIR ? { cacheDir: process.env.VITE_QA_CACHE_DIR } : {}),
  plugins: [react()],
  resolve: {
    alias: viteAliases,
  },
});
