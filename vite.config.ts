import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: { host: true },
  build: { target: 'es2022', chunkSizeWarningLimit: 2500 },
  optimizeDeps: { exclude: ['@dimforge/rapier3d-compat'] },
});
