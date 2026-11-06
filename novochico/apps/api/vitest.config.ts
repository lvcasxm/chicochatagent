import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Carrega o .env da raiz (se existir) para que TEST_DATABASE_URL chegue aos testes de integração.
try {
  process.loadEnvFile(fileURLToPath(new URL('../../.env', import.meta.url)));
} catch {
  // Sem .env: os testes de integração que dependem dele são ignorados.
}

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
  },
});
