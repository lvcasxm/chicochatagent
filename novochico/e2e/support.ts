import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { BrowserContext, Page } from '@playwright/test';
import pg from 'pg';

const require = createRequire(import.meta.url);

try {
  process.loadEnvFile('.env');
} catch {
  // Sem .env: TEST_DATABASE_URL vem do ambiente.
}

const adminUrl = process.env.TEST_DATABASE_URL ?? '';
const dbUrl = new URL(adminUrl);
dbUrl.pathname = '/chicochat_e2e';

let counter = 0;

/** Cria um usuário (com o aviso de privacidade aceito) e uma sessão, direto no banco do E2E. */
export async function signIn(
  context: BrowserContext,
  role: 'user' | 'admin' = 'user',
): Promise<{ email: string }> {
  counter += 1;
  const stamp = `${Date.now()}-${counter}`;
  const email = `e2e.${role}.${stamp}@prefeitura.example.test`;
  const token = randomBytes(32).toString('base64url');
  const hash = createHash('sha256').update(token).digest('hex');

  const client = new pg.Client({ connectionString: dbUrl.toString() });
  await client.connect();
  try {
    const { rows } = await client.query<{ id: string }>(
      `insert into users (email, full_name, role, google_sub, privacy_ack_at, privacy_ack_version)
       values ($1, $2, $3, $4, now(), '2026-11') returning id`,
      [email, `Pessoa de Teste ${stamp}`, role, `e2e-sub-${stamp}`],
    );
    await client.query(
      `insert into sessions (user_id, token_hash, expires_at)
       values ($1, $2, now() + interval '2 hours')`,
      [rows[0]?.id, hash],
    );
  } finally {
    await client.end();
  }

  await context.addCookies([
    { name: 'chico_session', value: token, domain: '127.0.0.1', path: '/', httpOnly: true },
  ]);
  return { email };
}

interface AxeResult {
  violations: Array<{ id: string; impact: string | null; nodes: Array<{ html: string }> }>;
}

/** Injeta o axe-core na página e devolve as violações sérias ou críticas, com contraste. */
export async function seriousViolations(page: Page): Promise<string[]> {
  // Pelo protocolo do navegador, não por <script>: a CSP da aplicação (sem script em linha) fica
  // ligada durante o teste, e é ela que se está verificando.
  await page.evaluate(readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8'));
  return page.evaluate(async () => {
    const axe = (window as unknown as { axe: { run: () => Promise<AxeResult> } }).axe;
    const result = await axe.run();
    return result.violations
      .filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.html.slice(0, 120)).join(' | ')}`);
  });
}
