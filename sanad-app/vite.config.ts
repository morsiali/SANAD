import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// `npm run build` → dist/ served by the API server (full-stack mode).
// `npm run build:demo` → one self-contained HTML file that runs entirely in the browser.
export default defineConfig(({ mode }) => ({
  plugins: mode === 'demo' ? [react(), viteSingleFile()] : [react()],
  define: { __SANAD_MODE__: JSON.stringify(mode === 'demo' ? 'demo' : 'auto') },
  build: { outDir: mode === 'demo' ? 'dist-demo' : 'dist', emptyOutDir: true },
  server: { port: 5173, proxy: { '/api': { target: 'http://localhost:4000', changeOrigin: true } } },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
}));
