import { defineConfig } from '../../web/node_modules/vite/dist/node/index.js';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  // Only core.js goes into the APK assets; the web app's public/ files must not be copied there.
  publicDir: false,
  build: { target: 'es2022', sourcemap: false, emptyOutDir: false,
    outDir: fileURLToPath(new URL('../app/src/main/assets', import.meta.url)),
    lib: { entry: fileURLToPath(new URL('./entry.ts', import.meta.url)), name: 'ConvoProtocol', formats: ['iife'], fileName: () => 'core.js' },
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
  resolve: { alias: { '@noble/post-quantum/ml-dsa.js': fileURLToPath(new URL('./optional-stub.ts', import.meta.url)), '@hpke/chacha20poly1305': fileURLToPath(new URL('./optional-stub.ts', import.meta.url)), '@hpke/dhkem-x448': fileURLToPath(new URL('./optional-stub.ts', import.meta.url)), '@hpke/ml-kem': fileURLToPath(new URL('./optional-stub.ts', import.meta.url)), '@hpke/hybridkem-x-wing': fileURLToPath(new URL('./optional-stub.ts', import.meta.url)),
    '@privacyresearch/libsignal-protocol-typescript': fileURLToPath(new URL('../../web/node_modules/@privacyresearch/libsignal-protocol-typescript', import.meta.url)) } },
});
