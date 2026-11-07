import { defineConfig } from '@playwright/test';

/**
 * E2E com os fakes de IA e de GLPI, contra a interface servida pela própria API (a mesma
 * montagem da produção). Quatro combinações: desktop e celular, tema claro e escuro. Usa o Chrome
 * instalado na máquina, sem baixar navegador.
 */
const desktop = { viewport: { width: 1280, height: 800 } };
const mobile = {
  viewport: { width: 375, height: 812 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 2,
};

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  // Um banco só e limites por usuário: um teste por vez, cada um com os próprios usuários.
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:3199',
    channel: 'chrome',
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop-claro', use: { ...desktop, colorScheme: 'light' } },
    { name: 'desktop-escuro', use: { ...desktop, colorScheme: 'dark' } },
    { name: 'celular-claro', use: { ...mobile, colorScheme: 'light' } },
    { name: 'celular-escuro', use: { ...mobile, colorScheme: 'dark' } },
  ],
  webServer: {
    command: 'node serve.mjs',
    url: 'http://127.0.0.1:3199/api/health',
    timeout: 240_000,
    reuseExistingServer: false,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
