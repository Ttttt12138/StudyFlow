import { defineConfig } from 'vite';
export default defineConfig({
  plugins: [{
    name: 'isolate-dev-cache',
    apply: 'serve',
    config: config => ({ cacheDir: config.cacheDir ?? `node_modules/.vite-dev-${config.server?.port ?? 5173}` }),
  }],
  resolve: { dedupe: ['react', 'react-dom'] },
  server: {
    host: '127.0.0.1',
    // The browser suites and CI expect port 5173; fail instead of moving to another port.
    port: 5173,
    strictPort: true,
    proxy: { '/api': { target: process.env.STUDYFLOW_API_URL || 'http://127.0.0.1:8000', changeOrigin: false } },
  },
});
