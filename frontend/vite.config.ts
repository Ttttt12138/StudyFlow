import { defineConfig } from 'vite';
export default defineConfig({
  server: {
    host: '127.0.0.1',
    // The browser suites and CI expect port 5173; fail instead of moving to another port.
    port: 5173,
    strictPort: true,
    proxy: { '/api': { target: 'http://127.0.0.1:8000', changeOrigin: false } },
  },
});
