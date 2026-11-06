/// <reference types="vitest/config" />
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  // A porta da API vem do .env da raiz, a mesma fonte usada pela própria API.
  const env = loadEnv(mode, fileURLToPath(new URL('../..', import.meta.url)), '');
  const apiPort = env.PORT || '3000';

  return {
    plugins: [react()],
    server: {
      host: '127.0.0.1',
      port: 5173,
      strictPort: true,
      // Mesma origem em produção: o navegador só fala com /api.
      proxy: { '/api': `http://127.0.0.1:${apiPort}` },
    },
    test: {
      environment: 'jsdom',
      include: ['src/**/*.test.{ts,tsx}'],
    },
  };
});
