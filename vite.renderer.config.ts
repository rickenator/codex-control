import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  // Relative URLs keep renderer assets within Consiglio's privileged custom
  // protocol instead of resolving them against the filesystem root.
  base: './',
  plugins: [react()],
  root: 'src',
  build: {
    outDir: '../dist/renderer',
    emptyOutDir: true,
    rollupOptions: {
      input: path.resolve(__dirname, 'src/index.html'),
      output: {
        manualChunks: (id) => {
          if (id.includes('react') || id.includes('react-dom')) {
            return 'vendor-react';
          }
        },
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
});
