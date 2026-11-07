// Prepara um banco novo, constrói a interface e sobe a API com os fakes, para os testes E2E.
// Roda como `webServer` do Playwright: o processo fica vivo enquanto os testes rodam.
import { execFileSync, spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
try {
  process.loadEnvFile('.env');
} catch {
  // Sem .env: a variável TEST_DATABASE_URL precisa vir do ambiente.
}

const adminUrl = process.env.TEST_DATABASE_URL;
if (!adminUrl) throw new Error('Defina TEST_DATABASE_URL (PostgreSQL de teste, do Compose).');

export const E2E_DB = 'chicochat_e2e';
const url = new URL(adminUrl);
url.pathname = `/${E2E_DB}`;
const databaseUrl = url.toString();

const admin = new pg.Client({ connectionString: adminUrl });
await admin.connect();
await admin.query(`DROP DATABASE IF EXISTS "${E2E_DB}" WITH (FORCE)`);
await admin.query(`CREATE DATABASE "${E2E_DB}"`);
await admin.end();

const run = (args, env = {}) =>
  execFileSync('npm', args, {
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, ...env, DATABASE_URL: databaseUrl },
  });

run(['run', 'build', '-w', '@chicochat/web'], { NODE_ENV: 'production' });
run(['run', 'db:migrate']);
run(['run', 'db:seed']);

const api = spawn('npm', ['run', 'start', '-w', '@chicochat/api'], {
  stdio: 'inherit',
  shell: true,
  env: {
    ...process.env,
    NODE_ENV: 'development',
    HOST: '127.0.0.1',
    PORT: '3199',
    APP_PUBLIC_URL: 'http://127.0.0.1:3199',
    DATABASE_URL: databaseUrl,
    SESSION_SECRET: 'segredo-e2e-com-mais-de-trinta-e-dois-caracteres',
    ALLOWED_EMAIL_DOMAINS: 'prefeitura.example.test',
    AI_PROVIDER: 'fake',
    GLPI_PROVIDER: 'fake',
    WEB_DIST_DIR: join(root, 'apps', 'web', 'dist'),
    LOG_LEVEL: 'warn',
  },
});

const stop = () => api.kill();
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
api.on('exit', (code) => process.exit(code ?? 0));
