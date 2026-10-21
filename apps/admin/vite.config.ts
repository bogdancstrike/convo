import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

/** Admin console build: one page, no source maps, charts and Ant Design split into their own chunks. */
export default defineConfig({
  plugins: [react()],
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 1500,
    rollupOptions: { output: { manualChunks: { charts: ['echarts', 'echarts-for-react'], antd: ['antd', '@ant-design/icons'] } } },
  },
  test: { environment: 'node' },
});
