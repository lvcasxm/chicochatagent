/// <reference types="vitest/config" />
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * Porta da API, lida do .env da raiz (a mesma fonte usada pela própria API). Lê só a PORT de
 * propósito: `loadEnv` também leva o NODE_ENV do arquivo, e um .env de desenvolvimento faria o
 * `vite build` gerar um build de desenvolvimento.
 */
function apiPortFromEnvFile(): string {
  try {
    const text = readFileSync(fileURLToPath(new URL('../../.env', import.meta.url)), 'utf8');
    return /^PORT=(\d+)\s*$/m.exec(text)?.[1] ?? '3000';
  } catch {
    return '3000';
  }
}

export default defineConfig(() => {
  const apiPort = apiPortFromEnvFile();

  return {
    plugins: [tailwindcss(), react()],
    server: {
      host: '127.0.0.1',
      port: 5173,
      strictPort: true,
      // Mesma origem em produção: o navegador só fala com /api.
      proxy: { '/api': `http://127.0.0.1:${apiPort}` },
    },
    test: {
      environment: 'jsdom',
      setupFiles: ['src/test/setup.ts'],
      // tokens.test.ts lê o CSS dos tokens como texto; por padrão o Vitest o esvazia.
      css: { include: [/tokens\.css/] },
      include: ['src/**/*.test.{ts,tsx}'],
    },
  };
});
