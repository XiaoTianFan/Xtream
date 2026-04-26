import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src/renderer',
  base: './',
  build: {
    outDir: '../../dist/renderer',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        control: resolve(__dirname, 'src/renderer/index.html'),
        display: resolve(__dirname, 'src/renderer/display.html'),
      },
    },
  },
});
