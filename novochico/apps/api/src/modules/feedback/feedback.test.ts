import { eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PRIVACY_NOTICE_VERSION, conversationDetailSchema, type UserRole } from '@chicochat/shared';
import { createApp } from '../../app';
import { analyticsEvents, conversations, feedbacks, ticketAttempts } from '../../db/schema';
import { seedDatabase } from '../../db/seed';
import { createScriptedLlm } from '../../integrations/gemini/fake';
import { createFakeGlpi } from '../../integrations/glpi/fake';
import { createConversations } from '../conversations';
import { createClock, insertUser, MINUTE } from '../../../test/auth-helpers';
import {
  createTestDatabase,
  expectPgError,
  PG,
  TEST_DATABASE_URL,
  type TestDatabase,
} from '../../../test/db';
import { captureLogger, testConfig } from '../../../test/helpers';
import { createSessionService } from '../auth/sessions';
import { createUsers } from '../users';
import { createFeedback } from './index';
import { createSessionCloser } from '../sessions';

const ORIGIN = testConfig.appOrigin;
let keyCounter = 0;
const newKey = () => `chave-f7-${String(++keyCounter).padStart(6, '0')}`;

// Precisa do PostgreSQL do Compose (`npm run db:up`) e de TEST_DATABASE_URL no .env.
describe.skipIf(!TEST_DATABASE_URL)('avaliação e encerramento por inatividade', () => {
  let test: TestDatabase;
  let app: FastifyInstance;
  const orm = () => test.db.orm;
  const clock = createClock();
  const log = captureLogger();
  const llm = createScriptedLlm(Array.from({ length: 30 }, () => ['Certo, vamos continuar.']));

  beforeAll(async () => {
    test = await createTestDatabase();
    await seedDatabase(orm());
    app = await createApp({
      config: testConfig,
      logger: log.logger,
      db: test.db,
      oidc: null,
      llm: llm.client,
      summaryLlm: createScriptedLlm(
        [],
        Array.from({ length: 5 }, () => null),
      ).client,
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
    await orm().execute(sql`truncate table users restart identity cascade`);
    await seedDatabase(orm());
  });

  const sessions = () =>
    createSessionService({
      orm: orm(),
      users: createUsers({ orm: orm(), now: clock.now }),
      now: clock.now,
    });

  async function actor(role: UserRole = 'user', options: { privacy?: boolean } = {}) {
    const accepted = options.privacy ?? true;
    const user = await insertUser(orm(), {
      role,
      fullName: 'Maria Silva Santos',
      ...(accepted ? { privacyAckAt: clock.now(), privacyAckVersion: PRIVACY_NOTICE_VERSION } : {}),
    });
    const { token } = await sessions().create(user.id);
    return { user, cookie: `chico_session=${token}` };
  }
  type Actor = Awaited<ReturnType<typeof actor>>;
  const headers = (who: Actor) => ({ cookie: who.cookie, origin: ORIGIN });

  async function conversationOf(
    who: Actor,
    patch: Partial<typeof conversations.$inferInsert> = {},
  ) {
    const [row] = await orm()
      .insert(conversations)
      .values({ userId: who.user.id, lastMessageAt: clock.now(), ...patch })
      .returning();
    if (!row) throw new Error('conversa não criada');
    return row.id;
  }

  const rate = (who: Actor | null, id: string, body: unknown) =>
    app.inject({
      method: 'POST',
      url: `/api/conversations/${id}/feedback`,
      headers: who ? headers(who) : { origin: ORIGIN },
      payload: body as Record<string, unknown>,
    });

  const triageOf = async (who: Actor, id: string) =>
    conversationDetailSchema.parse(
      (
        await app.inject({ method: 'GET', url: `/api/conversations/${id}`, headers: headers(who) })
      ).json(),
    ).triage.feedback;

  describe('quando a avaliação existe', () => {
    it('antes do desfecho não há avaliação: 409, e nada é gravado', async () => {
      const who = await actor();
      const id = await conversationOf(who);
      const response = await rate(who, id, { rating: 5 });
      expect(response.statusCode).toBe(409);
      expect((response.json() as { error: { code: string } }).error.code).toBe(
        'FEEDBACK_NOT_AVAILABLE',
      );
      expect(await orm().select().from(feedbacks)).toHaveLength(0);
      expect(await triageOf(who, id)).toBe('unavailable');
    });

    it.each(['resolved', 'escalated'] as const)(
      'depois de "%s" a avaliação é aceita',
      async (outcome) => {
        const who = await actor();
        const id = await conversationOf(who, { outcome });
        expect(await triageOf(who, id)).toBe('available');
        expect((await rate(who, id, { rating: 4, suggestion: 'Foi rápido' })).statusCode).toBe(204);
        expect(await triageOf(who, id)).toBe('given');
      },
    );

    it('sem desfecho ("no_outcome") e chamado de teste não abrem avaliação', async () => {
      const who = await actor();
      expect(
        (await rate(who, await conversationOf(who, { outcome: 'no_outcome' }), { rating: 5 }))
          .statusCode,
      ).toBe(409);
    });

    it('resolução confirmada na conversa libera a avaliação (fluxo real)', async () => {
      const who = await actor();
      const id = await conversationOf(who);
      const talk = await app.inject({
        method: 'POST',
        url: `/api/conversations/${id}/messages`,
        headers: headers(who),
        payload: { content: 'resolveu, obrigado' },
      });
      expect(talk.body).toContain('event: feedback_prompt');
      expect(await triageOf(who, id)).toBe('available');
    });

    it('chamado aberto de verdade libera a avaliação, ligada ao chamado (fluxo real)', async () => {
      const who = await actor();
      const id = await conversationOf(who, { ticketFormUnlockedAt: clock.now() });
      const opened = await app.inject({
        method: 'POST',
        url: `/api/conversations/${id}/tickets`,
        headers: { ...headers(who), 'idempotency-key': newKey() },
        payload: { sector: 'Saúde', machineIp: '10.1.2.30' },
      });
      expect(opened.statusCode).toBe(201);
      expect(await triageOf(who, id)).toBe('available');
      expect((await rate(who, id, { rating: 5 })).statusCode).toBe(204);
      const [saved] = await orm().select().from(feedbacks);
      const [attempt] = await orm().select().from(ticketAttempts);
      expect(saved?.ticketAttemptId).toBe(attempt?.id);
    });

    it('resolvida sem chamado: a avaliação não aponta para nenhum chamado', async () => {
      const who = await actor();
      const id = await conversationOf(who, { outcome: 'resolved' });
      await rate(who, id, { rating: 3 });
      expect((await orm().select().from(feedbacks))[0]?.ticketAttemptId).toBeNull();
    });
  });

  describe('dados enviados', () => {
    it.each([
      ['sem nota', {}],
      ['nota 0', { rating: 0 }],
      ['nota 6', { rating: 6 }],
      ['nota fracionada', { rating: 2.5 }],
      ['nota em texto', { rating: '4' }],
      ['sugestão de 1001 caracteres', { rating: 4, suggestion: 'x'.repeat(1001) }],
      ['campo a mais (userId)', { rating: 4, userId: 'outro' }],
      ['sugestão que não é texto', { rating: 4, suggestion: 42 }],
    ])('%s: 422, sem gravar', async (_name, body) => {
      const who = await actor();
      const id = await conversationOf(who, { outcome: 'resolved' });
      expect((await rate(who, id, body)).statusCode).toBe(422);
      expect(await orm().select().from(feedbacks)).toHaveLength(0);
    });

    it.each([1, 2, 3, 4, 5])('nota %i é aceita', async (rating) => {
      const who = await actor();
      const id = await conversationOf(who, { outcome: 'resolved' });
      expect((await rate(who, id, { rating })).statusCode).toBe(204);
      expect((await orm().select().from(feedbacks))[0]?.rating).toBe(rating);
    });

    it('sugestão: aparada, vazia vira nula e 1000 caracteres cabem', async () => {
      const who = await actor();
      const a = await conversationOf(who, { outcome: 'resolved' });
      const b = await conversationOf(who, { outcome: 'resolved' });
      const c = await conversationOf(who, { outcome: 'resolved' });
      await rate(who, a, { rating: 5, suggestion: '  Ótimo atendimento  ' });
      await rate(who, b, { rating: 5, suggestion: '   ' });
      await rate(who, c, { rating: 5, suggestion: 'x'.repeat(1000) });
      const rows = await orm().select().from(feedbacks);
      const by = (id: string) => rows.find((r) => r.conversationId === id)?.suggestion;
      expect(by(a)).toBe('Ótimo atendimento');
      expect(by(b)).toBeNull();
      expect(by(c)).toHaveLength(1000);
    });
  });

  describe('uma avaliação por conversa', () => {
    it('a segunda recebe 409 e a primeira continua valendo', async () => {
      const who = await actor();
      const id = await conversationOf(who, { outcome: 'resolved' });
      expect((await rate(who, id, { rating: 5, suggestion: 'primeira' })).statusCode).toBe(204);
      const again = await rate(who, id, { rating: 1, suggestion: 'segunda' });
      expect(again.statusCode).toBe(409);
      expect((again.json() as { error: { code: string } }).error.code).toBe(
        'FEEDBACK_ALREADY_SENT',
      );
      const rows = await orm().select().from(feedbacks);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ rating: 5, suggestion: 'primeira' });
    });

    it('envios simultâneos gravam uma avaliação só', async () => {
      const who = await actor();
      const id = await conversationOf(who, { outcome: 'resolved' });
      const results = await Promise.all(
        Array.from({ length: 6 }, (_, i) => rate(who, id, { rating: (i % 5) + 1 })),
      );
      expect(results.filter((r) => r.statusCode === 204)).toHaveLength(1);
      expect(results.filter((r) => r.statusCode === 409)).toHaveLength(5);
      expect(await orm().select().from(feedbacks)).toHaveLength(1);
    });

    it('a restrição única do banco vale mesmo fora da aplicação', async () => {
      const who = await actor();
      const id = await conversationOf(who, { outcome: 'resolved' });
      const row = { conversationId: id, userId: who.user.id, rating: 5 };
      await orm().insert(feedbacks).values(row);
      await expectPgError(orm().insert(feedbacks).values(row), PG.uniqueViolation);
    });

    it('conversas diferentes podem ser avaliadas', async () => {
      const who = await actor();
      for (let i = 0; i < 3; i++) {
        const id = await conversationOf(who, { outcome: 'resolved' });
        expect((await rate(who, id, { rating: 5 })).statusCode).toBe(204);
      }
      expect(await orm().select().from(feedbacks)).toHaveLength(3);
    });
  });

  describe('acesso', () => {
    it('conversa de outro usuário, inexistente ou id inválido: 404', async () => {
      const owner = await actor();
      const other = await actor();
      const id = await conversationOf(owner, { outcome: 'resolved' });
      for (const target of [id, '3f9a1c52-8d4e-4b7a-9c1e-2a6b5d8e0f13', 'nao-uuid']) {
        expect((await rate(other, target, { rating: 5 })).statusCode).toBe(404);
      }
      expect(await orm().select().from(feedbacks)).toHaveLength(0);
    });

    it('sem login: 401; sem aceite da privacidade: 403; sem Origin: 403', async () => {
      const who = await actor('user', { privacy: false });
      const id = await conversationOf(who, { outcome: 'resolved' });
      expect((await rate(null, id, { rating: 5 })).statusCode).toBe(401);
      expect((await rate(who, id, { rating: 5 })).statusCode).toBe(403);
      const ok = await actor();
      const noOrigin = await app.inject({
        method: 'POST',
        url: `/api/conversations/${await conversationOf(ok, { outcome: 'resolved' })}/feedback`,
        headers: { cookie: ok.cookie },
        payload: { rating: 5 },
      });
      expect(noOrigin.statusCode).toBe(403);
    });
  });

  describe('eventos', () => {
    it('rating_received leva a nota e se há sugestão, nunca o texto da sugestão', async () => {
      const who = await actor();
      const id = await conversationOf(who, { outcome: 'resolved', categoryKey: 'network' });
      await rate(who, id, { rating: 2, suggestion: 'SUGESTAO-SECRETA com dados' });
      const events = await orm()
        .select()
        .from(analyticsEvents)
        .where(eq(analyticsEvents.eventType, 'rating_received'));
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        userId: who.user.id,
        conversationId: id,
        category: 'network',
      });
      expect(events[0]?.metadata).toEqual({ rating: 2, hasSuggestion: true });
      expect(JSON.stringify(events)).not.toContain('SUGESTAO-SECRETA');
    });

    it('falha ao registrar o evento não desfaz a avaliação', async () => {
      const who = await actor();
      const id = await conversationOf(who, { outcome: 'resolved' });
      const feedback = createFeedback({
        orm: orm(),
        conversations: createConversations({ orm: orm(), now: clock.now }),
        analytics: { record: () => Promise.reject(new Error('banco de métricas fora')) },
        logger: log.logger,
      });
      await expect(
        feedback.submit({
          userId: who.user.id,
          conversationId: id,
          request: { rating: 4, suggestion: undefined },
        }),
      ).resolves.toBeUndefined();
      expect(await orm().select().from(feedbacks)).toHaveLength(1);
    });
  });

  describe('encerramento por inatividade', () => {
    const minutesAgo = (m: number) => new Date(clock.now().getTime() - m * MINUTE);
    const events = () =>
      orm()
        .select()
        .from(analyticsEvents)
        .where(eq(analyticsEvents.eventType, 'conversation_finished'));
    const row = async (id: string) => {
      const [found] = await orm().select().from(conversations).where(eq(conversations.id, id));
      if (!found) throw new Error('conversa não encontrada');
      return found;
    };

    it('só fecha depois de 30 minutos sem atividade', async () => {
      const who = await actor();
      const recent = await conversationOf(who, { lastMessageAt: minutesAgo(29) });
      const old = await conversationOf(who, { lastMessageAt: minutesAgo(31) });
      expect(await app.jobs.closeInactiveConversations()).toBe(1);
      expect((await row(recent)).finishedAt).toBeNull();
      expect((await row(old)).finishedAt).not.toBeNull();
    });

    it('o fim é o instante em que a sessão expirou, não o da varredura', async () => {
      const who = await actor();
      const last = minutesAgo(120);
      const id = await conversationOf(who, { lastMessageAt: last });
      await app.jobs.closeInactiveConversations();
      expect((await row(id)).finishedAt?.getTime()).toBe(last.getTime() + 30 * MINUTE);
    });

    it('sem desfecho vira "no_outcome"; resolvida e escalada mantêm o desfecho', async () => {
      const who = await actor();
      const none = await conversationOf(who, { lastMessageAt: minutesAgo(60) });
      const resolved = await conversationOf(who, {
        lastMessageAt: minutesAgo(60),
        outcome: 'resolved',
      });
      const escalated = await conversationOf(who, {
        lastMessageAt: minutesAgo(60),
        outcome: 'escalated',
      });
      await app.jobs.closeInactiveConversations();
      expect((await row(none)).outcome).toBe('no_outcome');
      expect((await row(resolved)).outcome).toBe('resolved');
      expect((await row(escalated)).outcome).toBe('escalated');
    });

    it('gera um evento por conversa, com o desfecho e sem conteúdo', async () => {
      const who = await actor();
      const id = await conversationOf(who, {
        lastMessageAt: minutesAgo(60),
        categoryKey: 'network',
        sector: 'Saúde',
      });
      await app.jobs.closeInactiveConversations();
      const found = await events();
      expect(found).toHaveLength(1);
      expect(found[0]).toMatchObject({
        conversationId: id,
        userId: who.user.id,
        category: 'network',
        sector: 'Saúde',
      });
      expect(found[0]?.metadata).toEqual({ outcome: 'no_outcome' });
    });

    it('rodar de novo não fecha nem registra de novo', async () => {
      const who = await actor();
      await conversationOf(who, { lastMessageAt: minutesAgo(60) });
      expect(await app.jobs.closeInactiveConversations()).toBe(1);
      expect(await app.jobs.closeInactiveConversations()).toBe(0);
      expect(await events()).toHaveLength(1);
    });

    it('o tempo é o do relógio do sistema: avançar 2 minutos cruza o limite', async () => {
      const who = await actor();
      const id = await conversationOf(who, { lastMessageAt: minutesAgo(29) });
      expect(await app.jobs.closeInactiveConversations()).toBe(0);
      clock.advance(2 * MINUTE);
      expect(await app.jobs.closeInactiveConversations()).toBe(1);
      expect((await row(id)).finishedAt).not.toBeNull();
    });

    it('falha ao registrar o evento não impede o fechamento', async () => {
      const who = await actor();
      const id = await conversationOf(who, { lastMessageAt: minutesAgo(60) });
      const closer = createSessionCloser({
        conversations: createConversations({ orm: orm(), now: clock.now }),
        analytics: { record: () => Promise.reject(new Error('métricas fora')) },
        logger: log.logger,
      });
      expect(await closer.closeInactive()).toBe(1);
      expect((await row(id)).finishedAt).not.toBeNull();
    });

    it('voltar a conversar depois de fechada abre uma nova sessão e reabre a conversa', async () => {
      const who = await actor();
      const id = await conversationOf(who, { lastMessageAt: minutesAgo(60) });
      await app.jobs.closeInactiveConversations();
      expect((await row(id)).outcome).toBe('no_outcome');
      const before = (await row(id)).attendanceSessionId;

      // O mesmo usuário volta: a conversa deixa de estar fechada e sem desfecho.
      await orm()
        .insert((await import('../../db/schema')).messages)
        .values({
          conversationId: id,
          role: 'user',
          content: 'voltei',
          createdAt: minutesAgo(61),
        });
      const talk = await app.inject({
        method: 'POST',
        url: `/api/conversations/${id}/messages`,
        headers: headers(who),
        payload: { content: 'ainda estou com o problema' },
      });
      expect(talk.statusCode).toBe(200);
      const after = await row(id);
      expect(after.finishedAt).toBeNull();
      expect(after.outcome).toBeNull();
      expect(after.attendanceSessionId).not.toBe(before);

      // Passada outra sessão de inatividade, fecha de novo e registra outro fim.
      clock.advance(40 * MINUTE);
      expect(await app.jobs.closeInactiveConversations()).toBe(1);
      expect(await events()).toHaveLength(2);
    });

    it('conversa resolvida que volta mantém o desfecho "resolved"', async () => {
      const who = await actor();
      const id = await conversationOf(who, { lastMessageAt: minutesAgo(60), outcome: 'resolved' });
      await app.jobs.closeInactiveConversations();
      await app.inject({
        method: 'POST',
        url: `/api/conversations/${id}/messages`,
        headers: headers(who),
        payload: { content: 'obrigado de novo' },
      });
      expect((await row(id)).outcome).toBe('resolved');
    });
  });
});
