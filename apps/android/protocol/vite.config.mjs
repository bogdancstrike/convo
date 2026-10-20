import { defineConfig } from '../../web/node_modules/vite/dist/node/index.js';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  build: { target: 'es2022', sourcemap: false, emptyOutDir: false,
    outDir: fileURLToPath(new URL('../app/src/main/assets', import.meta.url)),
    lib: { entry: fileURLToPath(new URL('./entry.ts', import.meta.url)), name: 'ConvoProtocol', formats: ['iife'], fileName: () => 'core.js' },
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
  resolve: { alias: { '@privacyresearch/libsignal-protocol-typescript': fileURLToPath(new URL('../../web/node_modules/@privacyresearch/libsignal-protocol-typescript', import.meta.url)) } },
});
