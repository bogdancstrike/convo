import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import istanbul from 'vite-plugin-istanbul';

/**
 * Vite configuration. In development the API, WebSocket and Keycloak are proxied so the app runs
 * same-origin, exactly like production behind nginx (see deploy/nginx/web.conf).
 */
const backend = process.env.ENCLAVE_DEV_BACKEND ?? 'http://localhost:8088';

// VITE_COVERAGE=1 builds an Istanbul-instrumented app for e2e coverage (docs/testing.md); never for releases.
const coverage = process.env.VITE_COVERAGE === '1';

export default defineConfig({
  plugins: [react(), ...(coverage ? [istanbul({ include: 'src/*', exclude: ['node_modules', '**/*.test.*'], extension: ['.ts', '.tsx'], requireEnv: false, forceBuildInstrument: true })] : [])],
  build: {
    target: 'es2022',
    sourcemap: coverage,
    assetsInlineLimit: 0,
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
    // Component tests (.test.tsx) opt into jsdom with a `// @vitest-environment jsdom` comment.
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    coverage: { provider: 'v8', include: ['src/**'], exclude: ['src/**/*.test.*'], reporter: ['text-summary', 'json', 'html'] },
  },
});
