import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PRIVACY_NOTICE_VERSION, type UserRole } from '@chicochat/shared';
import { createApp } from '../app';
import { seedDatabase } from '../db/seed';
import { createScriptedLlm } from '../integrations/gemini/fake';
import { createFakeGlpi } from '../integrations/glpi/fake';
import { createSessionService } from '../modules/auth/sessions';
import { createUsers } from '../modules/users';
import { createClock, insertUser, MINUTE } from '../../test/auth-helpers';
import { createTestDatabase, TEST_DATABASE_URL, type TestDatabase } from '../../test/db';
import { captureLogger, testConfig } from '../../test/helpers';

const ORIGIN = testConfig.appOrigin;
const ID = '3f9a1c52-8d4e-4b7a-9c1e-2a6b5d8e0f13';

// Precisa do PostgreSQL do Compose (`npm run db:up`) e de TEST_DATABASE_URL no .env.
describe.skipIf(!TEST_DATABASE_URL)('limites por usuário nas rotas (seção K)', () => {
  let test: TestDatabase;
  let app: FastifyInstance;
  const orm = () => test.db.orm;
  const clock = createClock();

  beforeAll(async () => {
    test = await createTestDatabase();
    app = await createApp({
      config: testConfig,
      logger: captureLogger().logger,
      db: test.db,
      oidc: null,
      llm: createScriptedLlm([], []).client,
      summaryLlm: createScriptedLlm([], []).client,
      insightsLlm: createScriptedLlm([], []).client,
      glpi: createFakeGlpi().client,
      now: clock.now,
    });
    await app.ready();
  }, 30_000);

  afterAll(async () => {
    await app.close();
    await test.drop();
  }, 30_000);

  beforeEach(async () => {
    clock.set(new Date('2026-03-02T12:00:00.000Z'));
    await orm().execute(
      sql`truncate table users, categories, instruction_versions restart identity cascade`,
    );
    await seedDatabase(orm());
  });

  async function actor(role: UserRole = 'user') {
    const user = await insertUser(orm(), {
      role,
      privacyAckAt: clock.now(),
      privacyAckVersion: PRIVACY_NOTICE_VERSION,
    });
    const sessions = createSessionService({
      orm: orm(),
      users: createUsers({ orm: orm(), now: clock.now }),
      now: clock.now,
    });
    const { token } = await sessions.create(user.id);
    return { user, cookie: `chico_session=${token}` };
  }

  const get = (cookie: string, url: string) => app.inject({ url, headers: { cookie } });
  const post = (cookie: string, url: string, payload: object = {}) =>
    app.inject({ method: 'POST', url, headers: { cookie, origin: ORIGIN }, payload });

  /** Faz `count` chamadas e devolve os status, na ordem. */
  async function run(count: number, call: () => Promise<{ statusCode: number }>) {
    const statuses: number[] = [];
    for (let i = 0; i < count; i++) statuses.push((await call()).statusCode);
    return statuses;
  }

  it('tickets/mine: 10 por minuto, e volta depois de um minuto', async () => {
    const { cookie } = await actor();
    const statuses = await run(11, () => get(cookie, '/api/tickets/mine'));
    expect(statuses.slice(0, 10).every((status) => status === 200)).toBe(true);
    expect(statuses[10]).toBe(429);
    const blocked = await get(cookie, '/api/tickets/mine');
    expect(blocked.headers['retry-after']).toBeDefined();
    expect(blocked.json()).toMatchObject({ error: { code: 'RATE_LIMITED' } });

    clock.advance(MINUTE + 1000);
    const again = await actor();
    expect((await get(again.cookie, '/api/tickets/mine')).statusCode).toBe(200);
  });

  it('o limite é de cada pessoa: a rede compartilhada não bloqueia os colegas', async () => {
    const a = await actor();
    const b = await actor();
    await run(11, () => get(a.cookie, '/api/tickets/mine'));
    expect((await get(a.cookie, '/api/tickets/mine')).statusCode).toBe(429);
    expect((await get(b.cookie, '/api/tickets/mine')).statusCode).toBe(200);
  });

  it('ticket-check: 20 por minuto', async () => {
    const { cookie } = await actor();
    const statuses = await run(21, () => post(cookie, `/api/conversations/${ID}/ticket-check`));
    expect(statuses.slice(0, 20)).not.toContain(429);
    expect(statuses[20]).toBe(429);
  });

  it('abrir chamado: 5 por 10 minutos, contando também as recusadas', async () => {
    const { cookie } = await actor();
    const statuses = await run(6, () => post(cookie, `/api/conversations/${ID}/tickets`));
    expect(statuses.slice(0, 5)).not.toContain(429);
    expect(statuses[5]).toBe(429);
  });

  it('mensagens: 15 por minuto', async () => {
    const { cookie } = await actor();
    const statuses = await run(16, () =>
      post(cookie, `/api/conversations/${ID}/messages`, { content: 'oi' }),
    );
    expect(statuses.slice(0, 15)).not.toContain(429);
    expect(statuses[15]).toBe(429);
  });

  it('Análise IA: 5 por hora', async () => {
    const { cookie } = await actor('admin');
    const statuses = await run(6, () => post(cookie, '/api/admin/insights', {}));
    expect(statuses.slice(0, 5).every((status) => status === 200)).toBe(true);
    expect(statuses[5]).toBe(429);
    clock.advance(61 * MINUTE);
    const fresh = await actor('admin');
    expect((await post(fresh.cookie, '/api/admin/insights', {})).statusCode).toBe(200);
  });

  it('exportação: 5 por minuto', async () => {
    const { cookie } = await actor('admin');
    const statuses = await run(6, () => get(cookie, '/api/admin/export/feedbacks'));
    expect(statuses.slice(0, 5).every((status) => status === 200)).toBe(true);
    expect(statuses[5]).toBe(429);
  });

  it('quem não tem permissão recebe 403 antes de gastar o limite alheio', async () => {
    const { cookie } = await actor('user');
    expect((await post(cookie, '/api/admin/insights', {})).statusCode).toBe(403);
    expect((await get(cookie, '/api/admin/export/feedbacks')).statusCode).toBe(403);
  });
});
