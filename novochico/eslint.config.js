import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import { defineConfig } from 'eslint/config';

/**
 * Limites de importação de docs/ARCHITECTURE.md, seção 3, verificados por lint:
 * - `shared` não importa ninguém;
 * - `web` e `api` só se comunicam por `shared`;
 * - `integrations` não conhece `modules`;
 * - módulos só conversam entre si por `service`, nunca por `repository` ou `routes` de outro.
 */
const sharedImportsNothing = {
  files: ['packages/shared/src/**/*.ts'],
  rules: {
    'no-restricted-imports': [
      'error',
      {
        patterns: [
          {
            group: ['@chicochat/api', '@chicochat/api/*', '@chicochat/web', '@chicochat/web/*'],
            message: 'shared não pode depender de api nem de web.',
          },
          {
            group: ['fastify', 'pg', 'react', 'react-dom', 'drizzle-orm'],
            message: 'shared só contém contratos e constantes, sem dependência de runtime.',
          },
        ],
      },
    ],
  },
};

const webStaysInBrowser = {
  files: ['apps/web/src/**/*.{ts,tsx}'],
  rules: {
    'no-restricted-imports': [
      'error',
      {
        patterns: [
          {
            group: ['@chicochat/api', '@chicochat/api/*'],
            message: 'web só conversa com a API por HTTP e pelos contratos de shared.',
          },
          {
            group: ['fastify', 'pg', 'drizzle-orm', 'node:*'],
            message: 'Código do servidor não pode entrar no navegador.',
          },
        ],
      },
    ],
  },
};

const apiLayering = {
  files: ['apps/api/src/**/*.ts'],
  rules: {
    'no-restricted-imports': [
      'error',
      {
        patterns: [
          {
            group: ['@chicochat/web', '@chicochat/web/*', 'react', 'react-dom'],
            message: 'api não pode depender de web.',
          },
        ],
      },
    ],
  },
};

const integrationsDoNotKnowModules = {
  files: ['apps/api/src/integrations/**/*.ts'],
  rules: {
    'no-restricted-imports': [
      'error',
      {
        patterns: [
          {
            group: ['@chicochat/web', '@chicochat/web/*', 'react', 'react-dom'],
            message: 'api não pode depender de web.',
          },
          {
            group: ['**/modules', '**/modules/**'],
            message: 'integrations não conhece regras de negócio: não importe de modules.',
          },
        ],
      },
    ],
  },
};

const modulesTalkThroughServices = {
  files: ['apps/api/src/modules/**/*.ts'],
  rules: {
    'no-restricted-imports': [
      'error',
      {
        patterns: [
          {
            group: ['@chicochat/web', '@chicochat/web/*', 'react', 'react-dom'],
            message: 'api não pode depender de web.',
          },
          {
            // Importar o repository ou as rotas de outro módulo (../outro/repository).
            // O próprio módulo usa ./repository e não é afetado.
            group: ['../*/repository*', '../*/routes*', '../../*/repository*', '../../*/routes*'],
            message: 'Um módulo só usa outro por meio do service dele.',
          },
        ],
      },
    ],
  },
};

const onlyConfigReadsEnv = {
  files: ['apps/api/src/**/*.ts', 'packages/**/*.ts', 'apps/web/src/**/*.{ts,tsx}'],
  ignores: ['apps/api/src/config/**', '**/*.test.{ts,tsx}'],
  rules: {
    'no-restricted-properties': [
      'error',
      {
        object: 'process',
        property: 'env',
        message: 'Leia o ambiente só em apps/api/src/config e receba os valores por parâmetro.',
      },
    ],
  },
};

export default defineConfig(
  { ignores: ['**/dist/**', '**/coverage/**', '**/node_modules/**', 'docs/**', '.claude/**'] },
  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['apps/api/**/*.ts', 'packages/**/*.ts', 'eslint.config.js'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    extends: [reactHooks.configs.flat.recommended],
  },
  { files: ['**/*.{js,mjs}'], extends: [tseslint.configs.disableTypeChecked] },
  sharedImportsNothing,
  webStaysInBrowser,
  apiLayering,
  integrationsDoNotKnowModules,
  modulesTalkThroughServices,
  onlyConfigReadsEnv,
  // Testes e configuração de ferramentas podem ler o ambiente.
  {
    files: ['**/*.test.{ts,tsx}', 'apps/*/vite.config.ts', 'apps/*/vitest.config.ts'],
    rules: { 'no-restricted-properties': 'off' },
  },
);
