import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * Vite configuration. In development the API, WebSocket and Keycloak are proxied so the app runs
 * same-origin, exactly like production behind nginx (see deploy/nginx/web.conf).
 */
const backend = process.env.ENCLAVE_DEV_BACKEND ?? 'http://localhost:8088';

export default defineConfig({
  plugins: [react()],
  build: {
    target: 'es2022',
    sourcemap: false,
    assetsInlineLimit: 0,
    // Two pages: the messenger and the organization admin console (ADM-01).
    rollupOptions: { input: { main: 'index.html', admin: 'admin.html' } },
  },
  server: {
    port: 5173,
    proxy: {
      '/v1/ws': { target: backend.replace(/^http/, 'ws'), ws: true },
      '/v1': backend,
      '/auth': backend,
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
