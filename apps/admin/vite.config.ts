import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// لوحة الإدارة تُخدَم من /admin عبر خادم الـ API نفسه بعد البناء
export default defineConfig({
  plugins: [react()],
  base: '/admin/',
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  server: { port: 5173, proxy: { '/api': 'http://localhost:4000', '/static': 'http://localhost:4000' } },
  build: { outDir: 'dist', emptyOutDir: true },
});
