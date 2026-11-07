import { eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  PRIVACY_NOTICE_VERSION,
  adminConversationDetailSchema,
  adminConversationListSchema,
  auditResponseSchema,
  insightsResponseSchema,
  instructionsStateSchema,
  metricsResponseSchema,
  type UserRole,
} from '@chicochat/shared';
import { createApp } from '../../app';
import {
  aiResponseCache,
  analyticsEvents,
  auditLog,
  categories,
  conversations,
  feedbacks,
  instructionVersions,
  messages,
  ticketAttempts,
} from '../../db/schema';
import { seedDatabase } from '../../db/seed';
import { createScriptedLlm } from '../../integrations/gemini/fake';
import { LlmError, type LlmClient } from '../../integrations/gemini/llm';
import { createFakeGlpi } from '../../integrations/glpi/fake';
import { createClock, DAY, HOUR, insertUser, MINUTE } from '../../../test/auth-helpers';
import { createTestDatabase, TEST_DATABASE_URL, type TestDatabase } from '../../../test/db';
import { captureLogger, testConfig } from '../../../test/helpers';
import { promptVersion } from '../chat/prompt/build';
import { createSessionService } from '../auth/sessions';
import { createUsers } from '../users';

const ORIGIN = testConfig.appOrigin;
const NOW = new Date('2026-03-02T12:00:00.000Z');
const at = (iso: string) => new Date(iso);

// Precisa do PostgreSQL do Compose (`npm run db:up`) e de TEST_DATABASE_URL no .env.
describe.skipIf(!TEST_DATABASE_URL)('administração (F8)', () => {
  let test: TestDatabase;
  let app: FastifyInstance;
  const orm = () => test.db.orm;
  const clock = createClock();
  const log = captureLogger();
  /** Roteiros trocados por teste: o app lê sempre o atual. */
  let insightsScript: LlmClient = createScriptedLlm([], []).client;
  let chatScript: LlmClient = createScriptedLlm([], []).client;
  const insightsProxy: LlmClient = {
    generateJson: (input) => insightsScript.generateJson(input),
    streamChat: (input) => insightsScript.streamChat(input),
  };
  const chatProxy: LlmClient = {
    generateJson: (input) => chatScript.generateJson(input),
    streamChat: (input) => chatScript.streamChat(input),
  };

  beforeAll(async () => {
    test = await createTestDatabase();
    app = await createApp({
      config: testConfig,
      logger: log.logger,
      db: test.db,
      oidc: null,
      llm: chatProxy,
      summaryLlm: createScriptedLlm([], []).client,
      insightsLlm: insightsProxy,
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
    clock.set(NOW);
    await orm().execute(
      sql`truncate table users, categories, instruction_versions, ai_response_cache, analytics_events restart identity cascade`,
    );
    await seedDatabase(orm());
    insightsScript = createScriptedLlm([], []).client;
    chatScript = createScriptedLlm([], []).client;
  });

  const sessions = () =>
    createSessionService({
      orm: orm(),
      users: createUsers({ orm: orm(), now: clock.now }),
      now: clock.now,
    });

  async function actor(role: UserRole = 'admin') {
    const user = await insertUser(orm(), {
      role,
      privacyAckAt: clock.now(),
      privacyAckVersion: PRIVACY_NOTICE_VERSION,
    });
    const { token } = await sessions().create(user.id);
    return { user, cookie: `chico_session=${token}` };
  }

  async function call(
    cookie: string,
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    url: string,
    payload?: unknown,
  ) {
    return app.inject({
      method,
      url,
      headers: method === 'GET' ? { cookie } : { cookie, origin: ORIGIN },
      ...(payload === undefined ? {} : { payload: payload as object }),
    });
  }

  /* ------------------------------------------------------------------ dados de apoio */

  async function addConversation(
    userId: string,
    overrides: Partial<typeof conversations.$inferInsert> = {},
  ) {
    const [row] = await orm()
      .insert(conversations)
      .values({ userId, createdAt: NOW, lastMessageAt: NOW, ...overrides })
      .returning();
    if (!row) throw new Error('conversa não criada');
    return row;
  }

  async function addMessage(
    conversationId: string,
    role: 'user' | 'assistant',
    createdAt: Date,
    content = role === 'user' ? 'Minha impressora parou' : 'Vamos investigar.',
  ) {
    await orm()
      .insert(messages)
      .values({
        conversationId,
        role,
        content,
        source: role === 'assistant' ? 'llm' : null,
        createdAt,
      });
  }

  let attemptCounter = 0;
  async function addTicket(
    conversationId: string,
    userId: string,
    status: 'success' | 'failed' | 'unknown',
    createdAt: Date,
    isTest = false,
  ) {
    attemptCounter += 1;
    await orm()
      .insert(ticketAttempts)
      .values({
        conversationId,
        userId,
        idempotencyKey: `chave-${String(attemptCounter).padStart(6, '0')}`,
        status,
        glpiTicketId: status === 'success' ? `90${attemptCounter}` : null,
        requesterName: 'Servidor',
        requesterEmail: 'servidor@prefeitura.example.test',
        sector: 'Secretaria de Saúde',
        ipUnavailable: true,
        errorCode: status === 'success' ? null : 'GLPI_DOWN',
        isTest,
        createdAt,
      });
  }

  /* ------------------------------------------------------------------ indicadores */

  describe('indicadores', () => {
    async function seedKnownData() {
      const a = await insertUser(orm());
      const b = await insertUser(orm());
      // A: duas sessões (a segunda depois de 50 minutos de silêncio), resolvida.
      const c1 = await addConversation(a.id, {
        categoryKey: 'network',
        sector: 'Secretaria de Saúde',
        outcome: 'resolved',
        title: 'Internet lenta',
      });
      await addMessage(c1.id, 'user', at('2026-03-02T10:00:00Z'));
      await addMessage(c1.id, 'assistant', at('2026-03-02T10:00:30Z'));
      await addMessage(c1.id, 'user', at('2026-03-02T10:10:00Z'));
      await addMessage(c1.id, 'user', at('2026-03-02T11:00:00Z'));
      await addMessage(c1.id, 'assistant', at('2026-03-02T11:00:30Z'));
      // B: escalonada, com chamado aberto, uma falha e nota 4.
      const c2 = await addConversation(b.id, {
        categoryKey: 'network',
        sector: 'Secretaria de Educação',
        outcome: 'escalated',
      });
      await addMessage(c2.id, 'user', at('2026-03-02T09:00:00Z'));
      await addMessage(c2.id, 'assistant', at('2026-03-02T09:00:30Z'));
      await addTicket(c2.id, b.id, 'success', at('2026-03-02T09:30:00Z'));
      await addTicket(c2.id, b.id, 'failed', at('2026-03-02T09:20:00Z'));
      await orm()
        .insert(feedbacks)
        .values({
          conversationId: c2.id,
          userId: b.id,
          rating: 4,
          createdAt: at('2026-03-02T09:40:00Z'),
        });
      await orm()
        .insert(feedbacks)
        .values({
          conversationId: c1.id,
          userId: a.id,
          rating: 5,
          createdAt: at('2026-03-02T11:10:00Z'),
        });
      // Conversa de teste do administrador: não conta em nada.
      const t = await addConversation(b.id, { ticketFormTestMode: true, categoryKey: 'email' });
      await addMessage(t.id, 'user', at('2026-03-02T08:00:00Z'));
      await addTicket(t.id, b.id, 'success', at('2026-03-02T08:10:00Z'), true);
      // Conversa antiga: fora dos 30 dias.
      const old = await addConversation(a.id, {
        createdAt: at('2026-01-01T10:00:00Z'),
        lastMessageAt: at('2026-01-01T10:05:00Z'),
        outcome: 'no_outcome',
      });
      await addMessage(old.id, 'user', at('2026-01-01T10:00:00Z'));
      return { a, b, c1, c2 };
    }

    it('conta com os dados conhecidos e deixa de fora o teste (RF-065)', async () => {
      await seedKnownData();
      const { cookie } = await actor();
      const response = await call(cookie, 'GET', '/api/admin/metrics?period=30d');
      expect(response.statusCode).toBe(200);
      const m = metricsResponseSchema.parse(response.json());

      expect(m.indicators).toMatchObject({
        users: 2,
        sessions: 3,
        messages: 7,
        tickets: 1,
        failures: 1,
        averageRating: 4.5,
        ratingCount: 2,
      });
      expect(m.outcomes).toEqual({ resolved: 1, escalated: 1, noOutcome: 0, open: 0 });
      expect(m.funnel).toEqual({ users: 2, sessions: 3, answered: 2, escalated: 1, tickets: 1 });
      expect(m.ratingDistribution.map((r) => r.count)).toEqual([0, 0, 0, 1, 1]);
      expect(m.topCategories).toEqual([{ key: 'network', count: 2 }]);
      expect(m.topSectors).toHaveLength(2);
      expect(m.recentSessions.every((s) => s.conversationId.length > 0)).toBe(true);
      expect(m.recentSessions).toHaveLength(2);
      expect(m.recentFailures).toHaveLength(1);
      expect(m.recentFailures[0]?.errorCode).toBe('GLPI_DOWN');
    });

    it('a série diária cobre todos os dias, inclusive sem atividade', async () => {
      await seedKnownData();
      const { cookie } = await actor();
      const m = metricsResponseSchema.parse(
        (await call(cookie, 'GET', '/api/admin/metrics?period=30d')).json(),
      );
      expect(m.series).toHaveLength(30);
      expect(m.series.at(-1)).toEqual({ date: '2026-03-02', sessions: 3, users: 2, tickets: 1 });
      expect(m.series[0]?.date).toBe('2026-02-01');
      expect(m.series.slice(0, -1).every((d) => d.sessions === 0 && d.tickets === 0)).toBe(true);
    });

    it('"hoje" começa à meia-noite de São Paulo; "tudo" inclui o que é antigo', async () => {
      await seedKnownData();
      const { cookie } = await actor();
      const today = metricsResponseSchema.parse(
        (await call(cookie, 'GET', '/api/admin/metrics?period=today')).json(),
      );
      expect(today.from).toBe('2026-03-02T03:00:00.000Z');
      expect(today.indicators.sessions).toBe(3);

      // Às 01:00 em São Paulo (04:00Z de 03/03), "hoje" ainda não tem nada.
      clock.set(at('2026-03-03T03:30:00Z'));
      const lateAdmin = await actor();
      const early = metricsResponseSchema.parse(
        (await call(lateAdmin.cookie, 'GET', '/api/admin/metrics?period=today')).json(),
      );
      expect(early.from).toBe('2026-03-03T03:00:00.000Z');
      expect(early.indicators.sessions).toBe(0);
      clock.set(NOW);

      const all = metricsResponseSchema.parse(
        (await call(cookie, 'GET', '/api/admin/metrics?period=all')).json(),
      );
      expect(all.from).toBeNull();
      expect(all.indicators.sessions).toBe(4);
      expect(all.outcomes.noOutcome).toBe(1);
    });

    it('sem dados, devolve zeros e nota nula', async () => {
      const { cookie } = await actor();
      const m = metricsResponseSchema.parse(
        (await call(cookie, 'GET', '/api/admin/metrics')).json(),
      );
      expect(m.period).toBe('30d');
      expect(m.indicators.averageRating).toBeNull();
      expect(m.indicators.averageConversationMinutes).toBeNull();
      expect(m.indicators.sessions).toBe(0);
      expect(m.series).toHaveLength(30);
    });

    it('período inválido é recusado', async () => {
      const { cookie } = await actor();
      expect((await call(cookie, 'GET', '/api/admin/metrics?period=ontem')).statusCode).toBe(422);
    });

    it('usuário comum e técnico não têm acesso', async () => {
      for (const role of ['user', 'tecnico'] as const) {
        const { cookie } = await actor(role);
        expect((await call(cookie, 'GET', '/api/admin/metrics')).statusCode).toBe(403);
      }
    });
  });

  /* ------------------------------------------------------------------ conversas */

  describe('conversas', () => {
    it('busca por título, nome, e-mail e setor; as apagadas pelo usuário não aparecem', async () => {
      const maria = await insertUser(orm(), {
        fullName: 'Maria Souza',
        email: 'maria.souza@prefeitura.example.test',
      });
      const joao = await insertUser(orm(), { fullName: 'João Lima' });
      await addConversation(maria.id, { title: 'Impressora offline', sector: 'Procuradoria' });
      await addConversation(joao.id, { title: 'Senha do SEI', sector: 'Controladoria' });
      await addConversation(joao.id, { title: 'Apagada', deletedAt: NOW });
      const { cookie } = await actor();

      const list = async (q: string) =>
        adminConversationListSchema
          .parse(
            (
              await call(cookie, 'GET', `/api/admin/conversations?q=${encodeURIComponent(q)}`)
            ).json(),
          )
          .conversations.map((c) => c.title);

      expect(await list('')).toHaveLength(2);
      expect(await list('impressora')).toEqual(['Impressora offline']);
      expect(await list('maria souza')).toEqual(['Impressora offline']);
      expect(await list('souza@prefeitura')).toEqual(['Impressora offline']);
      expect(await list('controladoria')).toEqual(['Senha do SEI']);
      expect(await list('apagada')).toEqual([]);
      // Curingas do LIKE são tratados como texto.
      expect(await list('%')).toEqual([]);
      expect(await list('_')).toEqual([]);
    });

    it('pagina de 25 em 25', async () => {
      const u = await insertUser(orm());
      for (let i = 0; i < 27; i += 1) {
        await addConversation(u.id, {
          title: `Conversa ${i}`,
          lastMessageAt: new Date(NOW.getTime() - i * MINUTE),
        });
      }
      const { cookie } = await actor();
      const first = adminConversationListSchema.parse(
        (await call(cookie, 'GET', '/api/admin/conversations')).json(),
      );
      expect(first.conversations).toHaveLength(25);
      expect(first.hasMore).toBe(true);
      const second = adminConversationListSchema.parse(
        (await call(cookie, 'GET', '/api/admin/conversations?page=2')).json(),
      );
      expect(second.conversations).toHaveLength(2);
      expect(second.hasMore).toBe(false);
    });

    it('ler uma conversa grava a auditoria, sem conteúdo, e mostra chamado e nota', async () => {
      const u = await insertUser(orm());
      const conversation = await addConversation(u.id, { title: 'Internet' });
      await addMessage(
        conversation.id,
        'user',
        at('2026-03-02T10:00:00Z'),
        'Texto sigiloso do servidor',
      );
      await addMessage(conversation.id, 'assistant', at('2026-03-02T10:00:10Z'));
      await addTicket(conversation.id, u.id, 'success', at('2026-03-02T10:05:00Z'));
      await orm().insert(feedbacks).values({
        conversationId: conversation.id,
        userId: u.id,
        rating: 3,
        suggestion: 'Poderia ser mais rápido',
      });
      const admin = await actor();

      const response = await call(
        admin.cookie,
        'GET',
        `/api/admin/conversations/${conversation.id}`,
      );
      expect(response.statusCode).toBe(200);
      const detail = adminConversationDetailSchema.parse(response.json());
      expect(detail.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
      expect(detail.tickets).toHaveLength(1);
      expect(detail.tickets[0]?.glpiTicketId).toMatch(/^90/);
      expect(detail.feedback).toEqual({ rating: 3, suggestion: 'Poderia ser mais rápido' });

      const entries = await orm()
        .select()
        .from(auditLog)
        .where(eq(auditLog.action, 'conversation.read'));
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        actorId: admin.user.id,
        targetType: 'conversation',
        targetId: conversation.id,
        metadata: {},
      });
      expect(JSON.stringify(entries[0])).not.toContain('sigiloso');
    });

    it('conversa inexistente, apagada ou id inválido: 404, e nada é auditado', async () => {
      const u = await insertUser(orm());
      const deleted = await addConversation(u.id, { deletedAt: NOW });
      const { cookie } = await actor();
      for (const id of [deleted.id, '3f9a1c52-8d4e-4b7a-9c1e-2a6b5d8e0f13', 'xyz']) {
        const response = await call(cookie, 'GET', `/api/admin/conversations/${id}`);
        expect(response.statusCode, id).toBe(404);
      }
      expect(
        await orm().select().from(auditLog).where(eq(auditLog.action, 'conversation.read')),
      ).toHaveLength(0);
    });

    it('sem conseguir auditar, a conversa não é entregue', async () => {
      const u = await insertUser(orm());
      const conversation = await addConversation(u.id);
      await addMessage(conversation.id, 'user', NOW, 'conteúdo');
      const { cookie } = await actor();
      // Trigger de teste que recusa a gravação da auditoria.
      await orm().execute(sql`
        create or replace function block_audit() returns trigger language plpgsql as $$ begin raise exception 'auditoria indisponível'; end $$`);
      await orm().execute(
        sql`create trigger block_audit before insert on audit_log for each row execute function block_audit()`,
      );
      try {
        const response = await call(cookie, 'GET', `/api/admin/conversations/${conversation.id}`);
        expect(response.statusCode).toBe(500);
        expect(response.body).not.toContain('conteúdo');
      } finally {
        await orm().execute(sql`drop trigger block_audit on audit_log`);
        await orm().execute(sql`drop function block_audit()`);
      }
    });
  });

  /* ------------------------------------------------------------------ exportação */

  describe('exportação CSV', () => {
    it('gera BOM, separador ";" e protege contra fórmula', async () => {
      const u = await insertUser(orm(), { email: 'ana@prefeitura.example.test' });
      const conversation = await addConversation(u.id, { sector: '=SOMA(A1)' });
      await addMessage(
        conversation.id,
        'user',
        at('2026-03-02T10:00:00Z'),
        '=HYPERLINK("http://x.example","clique")',
      );
      await addMessage(conversation.id, 'user', at('2026-03-02T10:01:00Z'), '+1;2');
      await addMessage(conversation.id, 'user', at('2026-03-02T10:02:00Z'), '@cmd');
      await addMessage(conversation.id, 'user', at('2026-03-02T10:03:00Z'), '-5 graus');
      await addMessage(conversation.id, 'user', at('2026-03-02T10:04:00Z'), 'linha 1\nlinha "2"');
      await addMessage(conversation.id, 'user', at('2026-03-02T10:05:00Z'), 'normal');
      const admin = await actor();

      const response = await call(admin.cookie, 'GET', '/api/admin/export/messages?period=30d');
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toBe('text/csv; charset=utf-8');
      expect(response.headers['content-disposition']).toBe(
        'attachment; filename="chicochat-messages-20260302.csv"',
      );
      expect(response.headers['cache-control']).toBe('no-store');
      const body = response.body;
      expect(
        body.startsWith('﻿id;criada_em;conversa_id;papel;origem;conteudo;incompleta;teste\r\n'),
      ).toBe(true);
      expect(body).toContain(`;'=HYPERLINK(""http://x.example"",""clique"")`.replace(`;'`, `;"'`));
      expect(body).toContain(`;"'+1;2";`);
      expect(body).toContain(`;'@cmd;`);
      expect(body).toContain(`;'-5 graus;`);
      expect(body).toContain(`;"linha 1\nlinha ""2""";`);
      expect(body).toContain(';normal;');
      // Nenhuma célula perigosa sai sem a aspa de proteção.
      for (const cell of body.split(/[;\r\n]/)) {
        expect(/^[=+\-@]/.test(cell.replace(/^"/, '')), cell).toBe(false);
      }

      const conversationsCsv = (await call(admin.cookie, 'GET', '/api/admin/export/conversations'))
        .body;
      expect(conversationsCsv).toContain(";'=SOMA(A1);");
      expect(conversationsCsv).toContain('ana@prefeitura.example.test');
    });

    it('exporta os cinco tipos, filtra pelo período e audita cada exportação', async () => {
      const u = await insertUser(orm());
      const conversation = await addConversation(u.id);
      await addMessage(conversation.id, 'user', at('2026-03-02T10:00:00Z'));
      await addTicket(conversation.id, u.id, 'success', at('2026-03-02T10:05:00Z'));
      await orm().insert(feedbacks).values({
        conversationId: conversation.id,
        userId: u.id,
        rating: 5,
        suggestion: 'Ótimo',
        createdAt: NOW,
      });
      await orm()
        .insert(analyticsEvents)
        .values({
          eventType: 'conversation_started',
          userId: u.id,
          conversationId: conversation.id,
          createdAt: at('2026-03-02T10:00:00Z'),
        });
      const old = await addConversation(u.id, { createdAt: at('2025-01-01T00:00:00Z') });
      await addMessage(old.id, 'user', at('2025-01-01T00:00:00Z'), 'mensagem antiga');
      const admin = await actor();

      // Exportar é limitado a 5 por minuto: o relógio avança entre uma e outra.
      for (const type of ['conversations', 'messages', 'tickets', 'events', 'feedbacks']) {
        clock.advance(MINUTE);
        const response = await call(admin.cookie, 'GET', `/api/admin/export/${type}?period=7d`);
        expect(response.statusCode, type).toBe(200);
        const lines = response.body.trim().split('\r\n');
        expect(lines.length, type).toBeGreaterThanOrEqual(2);
      }
      clock.advance(MINUTE);
      const week = (await call(admin.cookie, 'GET', '/api/admin/export/messages?period=7d')).body;
      expect(week).not.toContain('mensagem antiga');
      clock.advance(MINUTE);
      const everything = (await call(admin.cookie, 'GET', '/api/admin/export/messages?period=all'))
        .body;
      expect(everything).toContain('mensagem antiga');

      const audited = await orm()
        .select()
        .from(auditLog)
        .where(eq(auditLog.action, 'export.created'));
      expect(audited).toHaveLength(7);
      expect(audited[0]).toMatchObject({
        actorId: admin.user.id,
        targetId: 'conversations',
        metadata: { period: '7d' },
      });
    });

    it('tipo desconhecido: 422; não administrador: 403, e nada é auditado', async () => {
      const admin = await actor();
      expect((await call(admin.cookie, 'GET', '/api/admin/export/senhas')).statusCode).toBe(422);
      const user = await actor('user');
      expect((await call(user.cookie, 'GET', '/api/admin/export/messages')).statusCode).toBe(403);
      expect(
        await orm().select().from(auditLog).where(eq(auditLog.action, 'export.created')),
      ).toHaveLength(0);
    });

    it('lê em lotes: 2.300 linhas saem completas, sem repetir nem pular', async () => {
      const u = await insertUser(orm());
      const conversation = await addConversation(u.id);
      const rows = Array.from({ length: 2300 }, (_, i) => ({
        conversationId: conversation.id,
        role: 'user' as const,
        content: `m${String(i).padStart(4, '0')}`,
        // Várias com o mesmo instante: o desempate pelo id precisa funcionar.
        createdAt: new Date(NOW.getTime() - (i % 50) * 1000),
      }));
      await orm().insert(messages).values(rows);
      const admin = await actor();

      const body = (await call(admin.cookie, 'GET', '/api/admin/export/messages')).body;
      const contents = [...body.matchAll(/;(m\d{4});/g)].map((m) => m[1]);
      expect(contents).toHaveLength(2300);
      expect(new Set(contents).size).toBe(2300);
    });
  });

  /* ------------------------------------------------------------------ cards */

  describe('cards da tela inicial', () => {
    const validCard = {
      key: 'novo-card',
      title: 'Novo assunto',
      cardDescription: 'Descrição curta',
      icon: 'Monitor',
      action: 'chat',
      externalUrl: null,
      secondaryLinkLabel: null,
      secondaryLinkUrl: null,
      cannedMessage: 'Olá! Preciso de ajuda com o novo assunto.',
      shortLabel: 'Novo assunto',
      sortOrder: 5,
      active: true,
    };

    it('lista todos, cria, edita e apaga, com auditoria', async () => {
      const admin = await actor();
      const listed = (await call(admin.cookie, 'GET', '/api/admin/categories')).json<{
        categories: unknown[];
      }>();
      expect(listed.categories.length).toBeGreaterThan(5);

      const created = await call(admin.cookie, 'POST', '/api/admin/categories', validCard);
      expect(created.statusCode).toBe(201);
      const card = created.json<{ id: string; key: string }>();

      const homeBefore = (await call(admin.cookie, 'GET', '/api/bootstrap')).json<{
        cards: Array<{ key: string }>;
      }>();
      expect(homeBefore.cards[0]?.key).toBe('novo-card'); // ordem 5 vem antes de 10

      const edited = await call(admin.cookie, 'PUT', `/api/admin/categories/${card.id}`, {
        ...(({ key: _key, ...rest }) => rest)(validCard),
        title: 'Título novo',
        active: false,
      });
      expect(edited.statusCode).toBe(200);
      expect(edited.json<{ title: string; active: boolean }>()).toMatchObject({
        title: 'Título novo',
        active: false,
      });
      const homeAfter = (await call(admin.cookie, 'GET', '/api/bootstrap')).json<{
        cards: Array<{ key: string }>;
      }>();
      expect(homeAfter.cards.some((c) => c.key === 'novo-card')).toBe(false);

      expect(
        (await call(admin.cookie, 'DELETE', `/api/admin/categories/${card.id}`)).statusCode,
      ).toBe(204);
      expect(
        await orm().select().from(categories).where(eq(categories.key, 'novo-card')),
      ).toHaveLength(0);

      const actions = (await orm().select().from(auditLog)).map((e) => e.action).sort();
      expect(actions).toEqual(['category.created', 'category.deleted', 'category.updated']);
    });

    it('recusa identificador repetido, link sem endereço e endereços perigosos', async () => {
      const admin = await actor();
      expect(
        (await call(admin.cookie, 'POST', '/api/admin/categories', validCard)).statusCode,
      ).toBe(201);
      expect(
        (await call(admin.cookie, 'POST', '/api/admin/categories', validCard)).statusCode,
      ).toBe(409);

      const link = {
        ...validCard,
        key: 'link-1',
        action: 'external_link',
        cannedMessage: null,
        shortLabel: null,
      };
      expect(
        (await call(admin.cookie, 'POST', '/api/admin/categories', { ...link, externalUrl: null }))
          .statusCode,
      ).toBe(422);
      for (const bad of [
        'javascript:alert(1)',
        'data:text/html,x',
        'ftp://x.example',
        'sem endereço',
      ]) {
        const response = await call(admin.cookie, 'POST', '/api/admin/categories', {
          ...link,
          key: 'link-2',
          externalUrl: bad,
        });
        expect(response.statusCode, bad).toBe(422);
      }
      const ok = await call(admin.cookie, 'POST', '/api/admin/categories', {
        ...link,
        key: 'link-3',
        externalUrl: 'https://exemplo.example.test/guia',
      });
      expect(ok.statusCode).toBe(201);
    });

    it('valida os demais campos', async () => {
      const admin = await actor();
      const post = (body: object) => call(admin.cookie, 'POST', '/api/admin/categories', body);
      expect((await post({ ...validCard, key: 'Maiúscula' })).statusCode).toBe(422);
      expect((await post({ ...validCard, key: 'a' })).statusCode).toBe(422);
      expect((await post({ ...validCard, key: 'k1', title: '' })).statusCode).toBe(422);
      expect((await post({ ...validCard, key: 'k2', icon: '<script>' })).statusCode).toBe(422);
      expect(
        (
          await post({
            ...validCard,
            key: 'k3',
            secondaryLinkLabel: 'Guia',
            secondaryLinkUrl: null,
          })
        ).statusCode,
      ).toBe(422);
      expect((await post({ ...validCard, key: 'k4', extra: 1 })).statusCode).toBe(422);
      expect(
        (
          await post({
            ...validCard,
            key: 'k5',
            action: 'external_link',
            externalUrl: 'https://a.example.test',
            cannedMessage: 'x',
          })
        ).statusCode,
      ).toBe(422);
    });

    it('editar ou apagar um card inexistente: 404', async () => {
      const admin = await actor();
      const id = '3f9a1c52-8d4e-4b7a-9c1e-2a6b5d8e0f13';
      const fields: Record<string, unknown> = { ...validCard };
      delete fields.key;
      expect(
        (await call(admin.cookie, 'PUT', `/api/admin/categories/${id}`, fields)).statusCode,
      ).toBe(404);
      expect((await call(admin.cookie, 'DELETE', `/api/admin/categories/${id}`)).statusCode).toBe(
        404,
      );
      expect((await call(admin.cookie, 'DELETE', '/api/admin/categories/xyz')).statusCode).toBe(
        404,
      );
    });
  });

  /* ------------------------------------------------------------------ instruções */

  describe('instruções do agente', () => {
    const state = async (cookie: string) =>
      instructionsStateSchema.parse((await call(cookie, 'GET', '/api/admin/instructions')).json());
    const proposal = (content: string, extra: Record<string, unknown> = {}) => ({
      content,
      summary: 'Resumo da mudança.',
      conflicts: [],
      questions: [],
      ...extra,
    });

    it('mostra a versão publicada, sem rascunho e com o histórico', async () => {
      const { cookie } = await actor();
      const s = await state(cookie);
      expect(s.published).toMatchObject({ version: 1, status: 'published' });
      expect(s.published.content.length).toBeGreaterThan(100);
      expect(s.draft).toBeNull();
      expect(s.aiAvailable).toBe(true);
      expect(s.maxLength).toBe(20000);
    });

    it('a IA propõe: vira rascunho, com resumo, conflitos e dúvidas, sem publicar', async () => {
      const { cookie, user } = await actor();
      const before = await state(cookie);
      const script = createScriptedLlm(
        [],
        [
          proposal(`${before.published.content}\n\nNova orientação.`, {
            summary: 'Acrescentou uma orientação.',
            conflicts: ['Conflita com o trecho sobre impressoras.'],
            questions: ['Qual é o prazo?'],
          }),
        ],
      );
      insightsScript = script.client;

      const response = await call(cookie, 'POST', '/api/admin/instructions/propose', {
        request: 'Peça sempre o número do patrimônio.',
      });
      expect(response.statusCode).toBe(200);
      const draft = response.json<{
        version: number;
        status: string;
        conflicts: string[];
        questions: string[];
        changeRequest: string;
      }>();
      expect(draft).toMatchObject({
        version: 2,
        status: 'draft',
        conflicts: ['Conflita com o trecho sobre impressoras.'],
        questions: ['Qual é o prazo?'],
        changeRequest: 'Peça sempre o número do patrimônio.',
      });

      // O assistente recebeu o documento e o pedido, e as regras fixas não passaram por ele.
      const sent = script.jsonCalls[0];
      expect(sent?.user).toContain(before.published.content);
      expect(sent?.user).toContain('Peça sempre o número do patrimônio.');
      expect(sent?.system).not.toContain('<<OPEN_TICKET_FORM>>');

      const after = await state(cookie);
      expect(after.published.version).toBe(1);
      expect(after.published.content).toBe(before.published.content);
      expect(after.draft?.version).toBe(2);
      expect(after.draft?.createdBy?.name).toBeTruthy();
      expect(user.id).toBeTruthy();
    });

    it('novo pedido parte do rascunho, não da versão publicada, e o rascunho continua único', async () => {
      const { cookie } = await actor();
      const published = (await state(cookie)).published.content;
      const script = createScriptedLlm(
        [],
        [proposal(`${published}\nA`), proposal(`${published}\nA\nB`)],
      );
      insightsScript = script.client;
      await call(cookie, 'POST', '/api/admin/instructions/propose', { request: 'Primeiro' });
      await call(cookie, 'POST', '/api/admin/instructions/propose', { request: 'Segundo' });
      expect(script.jsonCalls[1]?.user).toContain(`${published}\nA`);
      const rows = await orm().select().from(instructionVersions);
      expect(rows.filter((r) => r.status === 'draft')).toHaveLength(1);
      expect((await state(cookie)).draft?.content.endsWith('\nB')).toBe(true);
    });

    it.each([
      ['documento com marcador técnico', proposal('Texto <<OPEN_TICKET_FORM>> final')],
      ['documento vazio', proposal('   ')],
      ['documento grande demais', proposal('x'.repeat(20001))],
      ['sem resumo', { content: 'ok', conflicts: [], questions: [] }],
      ['formato errado', 'texto solto'],
      ['nulo', null],
    ])('proposta inválida (%s) não cria nem altera rascunho', async (_name, answer) => {
      const { cookie } = await actor();
      insightsScript = createScriptedLlm([], [answer]).client;
      const response = await call(cookie, 'POST', '/api/admin/instructions/propose', {
        request: 'Mude algo',
      });
      expect(response.statusCode).toBe(502);
      expect(response.json<{ error: { code: string } }>().error.code).toBe('PROPOSAL_INVALID');
      expect(
        await orm()
          .select()
          .from(instructionVersions)
          .where(eq(instructionVersions.status, 'draft')),
      ).toHaveLength(0);
    });

    it('IA fora do ar: erro claro, nenhum rascunho, e a edição manual continua', async () => {
      const { cookie } = await actor();
      insightsScript = createScriptedLlm([], [new LlmError('unavailable')]).client;
      const down = await call(cookie, 'POST', '/api/admin/instructions/propose', {
        request: 'Mude algo',
      });
      expect(down.statusCode).toBe(503);
      expect(down.json<{ error: { code: string } }>().error.code).toBe('AI_UNAVAILABLE');
      expect((await state(cookie)).draft).toBeNull();

      const manual = await call(cookie, 'PUT', '/api/admin/instructions/draft', {
        content: 'Texto manual.',
      });
      expect(manual.statusCode).toBe(200);
    });

    it('pedido vazio ou grande demais é recusado antes de chamar a IA', async () => {
      const { cookie } = await actor();
      const script = createScriptedLlm([], []);
      insightsScript = script.client;
      for (const request of ['', '   ', 'x'.repeat(2001)]) {
        const response = await call(cookie, 'POST', '/api/admin/instructions/propose', { request });
        expect(response.statusCode).toBe(422);
      }
      expect(script.jsonCalls).toHaveLength(0);
    });

    it('edição manual valida tamanho, vazio e marcadores técnicos', async () => {
      const { cookie } = await actor();
      const put = (content: unknown) =>
        call(cookie, 'PUT', '/api/admin/instructions/draft', { content });
      expect((await put('')).statusCode).toBe(422);
      expect((await put('   \n ')).statusCode).toBe(422);
      expect((await put('x'.repeat(20001))).statusCode).toBe(422);
      expect((await put('antes <<RESOLUTION_ATTEMPT>> depois')).statusCode).toBe(422);
      expect((await put(123)).statusCode).toBe(422);
      expect((await state(cookie)).draft).toBeNull();

      const ok = await put('Documento novo.');
      expect(ok.statusCode).toBe(200);
      expect((await put('Documento novo, de novo.')).statusCode).toBe(200);
      const s = await state(cookie);
      expect(s.draft).toMatchObject({ version: 2, content: 'Documento novo, de novo.' });
    });

    it('publicar exige a versão do rascunho visto e vira a nova versão em vigor', async () => {
      const { cookie, user } = await actor();
      await call(cookie, 'PUT', '/api/admin/instructions/draft', { content: 'Instruções novas.' });

      expect(
        (await call(cookie, 'POST', '/api/admin/instructions/draft/publish', {})).statusCode,
      ).toBe(422);
      const stale = await call(cookie, 'POST', '/api/admin/instructions/draft/publish', {
        version: 9,
      });
      expect(stale.statusCode).toBe(409);
      expect(stale.json<{ error: { code: string } }>().error.code).toBe('DRAFT_CHANGED');
      expect((await state(cookie)).published.version).toBe(1);

      const promptBefore = (await call(cookie, 'GET', '/api/admin/prompt')).json<{
        version: string;
        instructionsVersion: number;
      }>();
      const published = await call(cookie, 'POST', '/api/admin/instructions/draft/publish', {
        version: 2,
      });
      expect(published.statusCode).toBe(200);

      const s = await state(cookie);
      expect(s.published).toMatchObject({ version: 2, content: 'Instruções novas.' });
      expect(s.published.publishedBy?.name).toBeTruthy();
      expect(s.draft).toBeNull();
      expect(s.history.map((h) => [h.version, h.status])).toEqual([
        [2, 'published'],
        [1, 'archived'],
      ]);

      // A versão do prompt (e portanto a chave do cache) muda junto.
      const promptAfter = (await call(cookie, 'GET', '/api/admin/prompt')).json<{
        version: string;
        instructionsVersion: number;
      }>();
      expect(promptAfter.instructionsVersion).toBe(2);
      expect(promptAfter.version).toBe(promptVersion('Instruções novas.'));
      expect(promptAfter.version).not.toBe(promptBefore.version);

      const entries = await orm()
        .select()
        .from(auditLog)
        .where(eq(auditLog.action, 'instructions.published'));
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        actorId: user.id,
        targetId: '2',
        metadata: { version: 2, previousVersion: 1 },
      });
    });

    it('sem rascunho, não há o que publicar', async () => {
      const { cookie } = await actor();
      const response = await call(cookie, 'POST', '/api/admin/instructions/draft/publish', {
        version: 2,
      });
      expect(response.statusCode).toBe(409);
      expect(response.json<{ error: { code: string } }>().error.code).toBe('NO_DRAFT');
    });

    it('publicações simultâneas: uma vence, a outra falha, e só há uma versão em vigor', async () => {
      const { cookie } = await actor();
      await call(cookie, 'PUT', '/api/admin/instructions/draft', { content: 'Concorrência.' });
      const results = await Promise.all(
        Array.from({ length: 5 }, () =>
          call(cookie, 'POST', '/api/admin/instructions/draft/publish', { version: 2 }),
        ),
      );
      expect(results.filter((r) => r.statusCode === 200)).toHaveLength(1);
      expect(results.filter((r) => r.statusCode === 409)).toHaveLength(4);
      const rows = await orm().select().from(instructionVersions);
      expect(rows.filter((r) => r.status === 'published')).toHaveLength(1);
      expect(rows.find((r) => r.status === 'published')?.version).toBe(2);
      expect(
        await orm().select().from(auditLog).where(eq(auditLog.action, 'instructions.published')),
      ).toHaveLength(1);
    });

    it('restaurar cria um rascunho com o texto da versão antiga e não publica nada', async () => {
      const { cookie } = await actor();
      const original = (await state(cookie)).published.content;
      await call(cookie, 'PUT', '/api/admin/instructions/draft', { content: 'Versão dois.' });
      await call(cookie, 'POST', '/api/admin/instructions/draft/publish', { version: 2 });

      const restored = await call(cookie, 'POST', '/api/admin/instructions/1/restore');
      expect(restored.statusCode).toBe(200);
      expect(restored.json()).toMatchObject({
        version: 3,
        status: 'draft',
        content: original,
        changeSummary: 'Restaurada da versão 1.',
      });
      const s = await state(cookie);
      expect(s.published.version).toBe(2);
      expect(s.draft?.version).toBe(3);

      expect((await call(cookie, 'POST', '/api/admin/instructions/99/restore')).statusCode).toBe(
        404,
      );
      // O rascunho em si não é uma versão restaurável.
      expect((await call(cookie, 'POST', '/api/admin/instructions/3/restore')).statusCode).toBe(
        404,
      );
      expect(
        await orm()
          .select()
          .from(auditLog)
          .where(eq(auditLog.action, 'instructions.restored_to_draft')),
      ).toHaveLength(1);
    });

    it('lê uma versão antiga com o texto', async () => {
      const { cookie } = await actor();
      const original = (await state(cookie)).published.content;
      const version = await call(cookie, 'GET', '/api/admin/instructions/versions/1');
      expect(version.json<{ content: string }>().content).toBe(original);
      expect((await call(cookie, 'GET', '/api/admin/instructions/versions/42')).statusCode).toBe(
        404,
      );
      expect((await call(cookie, 'GET', '/api/admin/instructions/versions/abc')).statusCode).toBe(
        404,
      );
    });

    it('a IA nunca publica: depois de propor, o agente continua com a versão publicada', async () => {
      const { cookie } = await actor();
      const published = (await state(cookie)).published.content;
      insightsScript = createScriptedLlm([], [proposal('Conteúdo proposto pela IA.')]).client;
      await call(cookie, 'POST', '/api/admin/instructions/propose', { request: 'Troque tudo' });
      const prompt = (await call(cookie, 'GET', '/api/admin/prompt')).json<{ text: string }>();
      expect(prompt.text).toContain(published.trim());
      expect(prompt.text).not.toContain('Conteúdo proposto pela IA.');
      expect(
        await orm().select().from(auditLog).where(eq(auditLog.action, 'instructions.published')),
      ).toHaveLength(0);
    });

    it('só o administrador acessa', async () => {
      const user = await actor('user');
      expect((await call(user.cookie, 'GET', '/api/admin/instructions')).statusCode).toBe(403);
      expect(
        (await call(user.cookie, 'PUT', '/api/admin/instructions/draft', { content: 'x' }))
          .statusCode,
      ).toBe(403);
      expect(
        (await call(user.cookie, 'POST', '/api/admin/instructions/draft/publish', { version: 2 }))
          .statusCode,
      ).toBe(403);
    });
  });

  /* ------------------------------------------------------------------ ensaio e prompt efetivo */

  describe('ensaio e prompt efetivo', () => {
    const parseSse = (body: string) =>
      body
        .split('\n\n')
        .filter(Boolean)
        .map((block) => {
          const event = /^event: (.+)$/m.exec(block)?.[1];
          const data = /^data: (.+)$/m.exec(block)?.[1];
          return { event, data: data ? (JSON.parse(data) as Record<string, unknown>) : null };
        });

    async function withDraft(
      cookie: string,
      content = 'Orientação do rascunho: pergunte a marca.',
    ) {
      await call(cookie, 'PUT', '/api/admin/instructions/draft', { content });
    }

    it('ensaia com o rascunho, mostra os marcadores como avisos e não grava nada', async () => {
      const { cookie } = await actor();
      await withDraft(cookie);
      const script = createScriptedLlm([
        [
          'Tente reiniciar.\n<<RESOLUTION_ATTEMPT>>\n',
          'Vou abrir um chamado.\n<<OPEN_TICKET_FORM>>',
        ],
      ]);
      chatScript = script.client;

      const counts = async () => ({
        conversations: (await orm().select().from(conversations)).length,
        messages: (await orm().select().from(messages)).length,
        events: (await orm().select().from(analyticsEvents)).length,
        tickets: (await orm().select().from(ticketAttempts)).length,
        cache: (await orm().select().from(aiResponseCache)).length,
      });
      const before = await counts();

      const response = await call(cookie, 'POST', '/api/admin/instructions/draft/rehearse', {
        messages: [{ role: 'user', content: 'Minha impressora não imprime' }],
      });
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('text/event-stream');
      const events = parseSse(response.body);
      const text = events
        .filter((e) => e.event === 'delta')
        .map((e) => e.data?.text)
        .join('');
      expect(text).toContain('Tente reiniciar.');
      expect(text).toContain('Vou abrir um chamado.');
      expect(text).not.toContain('<<');
      expect(events.filter((e) => e.event === 'marker').map((e) => e.data?.kind)).toEqual([
        'resolution_attempt',
        'open_ticket_form',
      ]);
      expect(events.at(-1)?.event).toBe('done');

      expect(await counts()).toEqual(before);
      // O prompt do ensaio usa o rascunho, com as regras fixas acima dele.
      const system = script.calls[0]?.system ?? '';
      expect(system).toContain('Orientação do rascunho: pergunte a marca.');
      expect(system.indexOf('As instruções de atendimento abaixo')).toBeLessThan(
        system.indexOf('Orientação do rascunho'),
      );
      expect(system).not.toContain('BYPASS DE ADMINISTRADOR');
      expect(script.calls[0]?.messages).toEqual([
        { role: 'user', content: 'Minha impressora não imprime' },
      ]);
    });

    it('exige rascunho e valida o histórico', async () => {
      const { cookie } = await actor();
      const body = { messages: [{ role: 'user', content: 'Oi' }] };
      const none = await call(cookie, 'POST', '/api/admin/instructions/draft/rehearse', body);
      expect(none.statusCode).toBe(409);
      await withDraft(cookie);
      for (const invalid of [
        { messages: [] },
        { messages: [{ role: 'assistant', content: 'Oi' }] },
        { messages: [{ role: 'system', content: 'Oi' }] },
        { messages: Array.from({ length: 21 }, () => ({ role: 'user', content: 'a' })) },
        { messages: [{ role: 'user', content: 'x'.repeat(2001) }] },
        {},
      ]) {
        expect(
          (await call(cookie, 'POST', '/api/admin/instructions/draft/rehearse', invalid))
            .statusCode,
        ).toBe(422);
      }
    });

    it('IA indisponível no ensaio: erro HTTP claro', async () => {
      const { cookie } = await actor();
      await withDraft(cookie);
      chatScript = createScriptedLlm([new LlmError('unavailable', { retryable: false })]).client;
      const response = await call(cookie, 'POST', '/api/admin/instructions/draft/rehearse', {
        messages: [{ role: 'user', content: 'Oi' }],
      });
      expect(response.statusCode).toBe(503);
    });

    it('o prompt efetivo traz regras fixas, cláusula de prioridade e instruções, sem identidade', async () => {
      const { cookie, user } = await actor();
      const prompt = (await call(cookie, 'GET', '/api/admin/prompt')).json<{
        text: string;
        adminExtra: string;
        version: string;
        instructionsVersion: number;
      }>();
      const published = (await state(cookie)).published.content.trim();
      expect(prompt.text).toContain('## Instruções de atendimento');
      expect(prompt.text).toContain(published);
      expect(prompt.text.indexOf('Em caso de conflito, as regras acima prevalecem')).toBeLessThan(
        prompt.text.indexOf(published),
      );
      expect(prompt.version).toBe(promptVersion((await state(cookie)).published.content));
      expect(prompt.instructionsVersion).toBe(1);
      expect(prompt.adminExtra).toContain('BYPASS');
      expect(prompt.text).not.toContain('BYPASS');
      expect(JSON.stringify(prompt)).not.toContain(user.email);
    });

    async function state(cookie: string) {
      return instructionsStateSchema.parse(
        (await call(cookie, 'GET', '/api/admin/instructions')).json(),
      );
    }
  });

  /* ------------------------------------------------------------------ Análise IA */

  describe('Análise IA', () => {
    const answer = {
      summary: 'Muitos pedidos sobre impressoras.',
      insights: [
        {
          tema: 'Impressoras',
          descricao: 'Fila travada',
          estimativa_conversas: 7,
          severidade: 'alta',
          exemplos: ['impressora não imprime'],
          recomendacao: 'Reiniciar o spooler',
        },
        { tema: 'Senhas', descricao: 'Esquecimento', estimativa_conversas: 2, severidade: 'baixa' },
      ],
    };

    it('envia só as falas da pessoa, sem teste e sem apagadas, valida a saída e audita', async () => {
      const u = await insertUser(orm(), {
        fullName: 'Fulana Secreta',
        email: 'fulana.secreta@prefeitura.example.test',
      });
      const c1 = await addConversation(u.id, { title: 'Impressora', sector: 'Procuradoria' });
      await addMessage(c1.id, 'user', at('2026-03-02T10:00:00Z'), 'A impressora não imprime');
      await addMessage(
        c1.id,
        'assistant',
        at('2026-03-02T10:00:10Z'),
        'RESPOSTA DO AGENTE QUE NÃO PODE IR',
      );
      const test = await addConversation(u.id, {
        ticketFormTestMode: true,
        title: 'Teste interno',
      });
      await addMessage(test.id, 'user', at('2026-03-02T10:00:00Z'), 'conversa de teste');
      const gone = await addConversation(u.id, { deletedAt: NOW, title: 'Apagada' });
      await addMessage(gone.id, 'user', at('2026-03-02T10:00:00Z'), 'conversa apagada');
      const script = createScriptedLlm([], [answer]);
      insightsScript = script.client;
      const admin = await actor();

      const response = await call(admin.cookie, 'POST', '/api/admin/insights', { period: '30d' });
      expect(response.statusCode).toBe(200);
      const result = insightsResponseSchema.parse(response.json());
      expect(result.analyzedConversations).toBe(1);
      expect(result.truncated).toBe(false);
      expect(result.insights[0]).toMatchObject({
        theme: 'Impressoras',
        estimatedConversations: 7,
        severity: 'alta',
        recommendation: 'Reiniciar o spooler',
      });
      expect(result.insights[1]).toMatchObject({ examples: [], recommendation: null });

      const sent = script.jsonCalls[0]?.user ?? '';
      expect(sent).toContain('(Impressora) [Procuradoria]');
      expect(sent).toContain('A impressora não imprime');
      for (const forbidden of [
        'RESPOSTA DO AGENTE',
        'conversa de teste',
        'conversa apagada',
        'Fulana',
        'fulana.secreta',
      ]) {
        expect(sent).not.toContain(forbidden);
      }
      const audited = await orm()
        .select()
        .from(auditLog)
        .where(eq(auditLog.action, 'insights.generated'));
      expect(audited).toHaveLength(1);
      expect(audited[0]).toMatchObject({
        actorId: admin.user.id,
        metadata: { period: '30d', conversations: 1 },
      });
      expect(JSON.stringify(audited[0])).not.toContain('impressora');
    });

    it('sem conversas no período, responde sem chamar a IA', async () => {
      const script = createScriptedLlm([], []);
      insightsScript = script.client;
      const { cookie } = await actor();
      const result = insightsResponseSchema.parse(
        (await call(cookie, 'POST', '/api/admin/insights', {})).json(),
      );
      expect(result).toMatchObject({ analyzedConversations: 0, insights: [], truncated: false });
      expect(script.jsonCalls).toHaveLength(0);
    });

    it('avisa quando há mais conversas que o limite da amostra', async () => {
      const u = await insertUser(orm());
      const rows = Array.from({ length: 503 }, (_, i) => ({
        userId: u.id,
        title: `c${i}`,
        createdAt: new Date(NOW.getTime() - i * 1000),
        lastMessageAt: NOW,
      }));
      const created = await orm()
        .insert(conversations)
        .values(rows)
        .returning({ id: conversations.id });
      await orm()
        .insert(messages)
        .values(
          created.map((c) => ({
            conversationId: c.id,
            role: 'user' as const,
            content: 'ajuda',
            createdAt: NOW,
          })),
        );
      insightsScript = createScriptedLlm([], [answer]).client;
      const { cookie } = await actor();
      const result = insightsResponseSchema.parse(
        (await call(cookie, 'POST', '/api/admin/insights', { period: '30d' })).json(),
      );
      expect(result.analyzedConversations).toBe(500);
      expect(result.truncated).toBe(true);
    });

    it.each([
      ['formato errado', { resumo: 'x' }],
      [
        'severidade inválida',
        {
          summary: 'x',
          insights: [{ tema: 't', descricao: 'd', estimativa_conversas: 1, severidade: 'critica' }],
        },
      ],
      [
        'estimativa negativa',
        {
          summary: 'x',
          insights: [{ tema: 't', descricao: 'd', estimativa_conversas: -1, severidade: 'alta' }],
        },
      ],
    ])('saída inválida da IA (%s): 502', async (_name, bad) => {
      const u = await insertUser(orm());
      const c = await addConversation(u.id);
      await addMessage(c.id, 'user', NOW);
      insightsScript = createScriptedLlm([], [bad]).client;
      const { cookie } = await actor();
      expect((await call(cookie, 'POST', '/api/admin/insights', {})).statusCode).toBe(502);
    });

    it('IA fora do ar: 503; corpo com campo extra: 422', async () => {
      const u = await insertUser(orm());
      const c = await addConversation(u.id);
      await addMessage(c.id, 'user', NOW);
      insightsScript = createScriptedLlm([], [new LlmError('unavailable')]).client;
      const { cookie } = await actor();
      expect((await call(cookie, 'POST', '/api/admin/insights', {})).statusCode).toBe(503);
      expect(
        (await call(cookie, 'POST', '/api/admin/insights', { period: '30d', x: 1 })).statusCode,
      ).toBe(422);
    });
  });

  /* ------------------------------------------------------------------ usuários e auditoria */

  describe('usuários e papéis', () => {
    it('lista e busca por nome ou e-mail', async () => {
      await insertUser(orm(), {
        fullName: 'Beatriz Alves',
        email: 'beatriz@prefeitura.example.test',
      });
      await insertUser(orm(), { fullName: 'Carlos Dias', email: 'carlos@prefeitura.example.test' });
      const { cookie } = await actor();
      const all = (await call(cookie, 'GET', '/api/admin/users')).json<{
        users: Array<{ fullName: string }>;
      }>();
      expect(all.users).toHaveLength(3);
      const found = (await call(cookie, 'GET', '/api/admin/users?q=carlos@')).json<{
        users: Array<{ fullName: string }>;
      }>();
      expect(found.users.map((u) => u.fullName)).toEqual(['Carlos Dias']);
      expect(JSON.stringify(all)).not.toContain('googleSub');
      expect(JSON.stringify(all)).not.toContain('google-sub');
    });

    it('troca o papel e audita; o novo papel vale na requisição seguinte', async () => {
      const admin = await actor();
      const target = await actor('user');
      expect((await call(target.cookie, 'GET', '/api/admin/metrics')).statusCode).toBe(403);

      const response = await call(
        admin.cookie,
        'PATCH',
        `/api/admin/users/${target.user.id}/role`,
        { role: 'admin' },
      );
      expect(response.statusCode).toBe(204);
      expect((await call(target.cookie, 'GET', '/api/admin/metrics')).statusCode).toBe(200);

      const entries = await orm()
        .select()
        .from(auditLog)
        .where(eq(auditLog.action, 'user.role_changed'));
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        actorId: admin.user.id,
        targetId: target.user.id,
        metadata: { from: 'user', to: 'admin', via: 'admin' },
      });
    });

    it('não remove o último administrador, nem o próprio acesso quando é o único', async () => {
      const admin = await actor();
      const own = await call(admin.cookie, 'PATCH', `/api/admin/users/${admin.user.id}/role`, {
        role: 'user',
      });
      expect(own.statusCode).toBe(409);
      expect(own.json<{ error: { code: string } }>().error.code).toBe('LAST_ADMIN');

      const other = await actor();
      await call(admin.cookie, 'PATCH', `/api/admin/users/${other.user.id}/role`, {
        role: 'admin',
      });
      // Com dois administradores, um pode abrir mão do próprio acesso.
      const second = await call(admin.cookie, 'PATCH', `/api/admin/users/${admin.user.id}/role`, {
        role: 'tecnico',
      });
      expect(second.statusCode).toBe(204);
    });

    it('dois rebaixamentos simultâneos nunca zeram os administradores', async () => {
      const a = await actor();
      const b = await actor();
      const results = await Promise.all([
        call(a.cookie, 'PATCH', `/api/admin/users/${b.user.id}/role`, { role: 'user' }),
        call(b.cookie, 'PATCH', `/api/admin/users/${a.user.id}/role`, { role: 'user' }),
      ]);
      expect(results.filter((r) => r.statusCode === 204).length).toBeLessThanOrEqual(1);
      const admins = await orm().execute(
        sql`select count(*)::int as total from users where role = 'admin'`,
      );
      expect((admins.rows[0] as { total: number }).total).toBeGreaterThanOrEqual(1);
    });

    it('papel inválido: 422; usuário inexistente: 404; não administrador: 403', async () => {
      const admin = await actor();
      const target = await actor('user');
      expect(
        (
          await call(admin.cookie, 'PATCH', `/api/admin/users/${target.user.id}/role`, {
            role: 'root',
          })
        ).statusCode,
      ).toBe(422);
      expect(
        (
          await call(admin.cookie, 'PATCH', `/api/admin/users/${target.user.id}/role`, {
            role: 'user',
            x: 1,
          })
        ).statusCode,
      ).toBe(422);
      expect(
        (
          await call(
            admin.cookie,
            'PATCH',
            '/api/admin/users/3f9a1c52-8d4e-4b7a-9c1e-2a6b5d8e0f13/role',
            { role: 'user' },
          )
        ).statusCode,
      ).toBe(404);
      expect(
        (await call(admin.cookie, 'PATCH', '/api/admin/users/xyz/role', { role: 'user' }))
          .statusCode,
      ).toBe(404);
      expect(
        (
          await call(target.cookie, 'PATCH', `/api/admin/users/${target.user.id}/role`, {
            role: 'admin',
          })
        ).statusCode,
      ).toBe(403);
      expect((await orm().select().from(auditLog)).length).toBe(0);
    });
  });

  describe('auditoria', () => {
    it('lista com o nome de quem agiu, do mais recente ao mais antigo, e filtra por ação', async () => {
      const admin = await actor();
      const target = await actor('user');
      await call(admin.cookie, 'PATCH', `/api/admin/users/${target.user.id}/role`, {
        role: 'tecnico',
      });
      clock.advance(HOUR);
      await call(admin.cookie, 'GET', '/api/admin/export/messages');

      const all = auditResponseSchema.parse(
        (await call(admin.cookie, 'GET', '/api/admin/audit')).json(),
      );
      expect(all.entries.map((e) => e.action)).toEqual(['export.created', 'user.role_changed']);
      expect(all.entries[0]?.actorName).toBe(admin.user.fullName);
      expect(all.entries[1]?.metadata).toMatchObject({ from: 'user', to: 'tecnico' });

      const filtered = auditResponseSchema.parse(
        (await call(admin.cookie, 'GET', '/api/admin/audit?action=user.role_changed')).json(),
      );
      expect(filtered.entries).toHaveLength(1);
    });

    it('é só leitura: não há rota para alterar ou apagar registros', async () => {
      const admin = await actor();
      for (const method of ['POST', 'PUT', 'PATCH', 'DELETE'] as const) {
        const response = await call(admin.cookie, method, '/api/admin/audit', {});
        expect(response.statusCode, method).toBe(404);
      }
    });

    it('só o administrador lê', async () => {
      const tecnico = await actor('tecnico');
      expect((await call(tecnico.cookie, 'GET', '/api/admin/audit')).statusCode).toBe(403);
    });
  });

  it('o que acontece com o dia seguinte: o período "7d" usa o relógio do servidor', async () => {
    clock.set(new Date(NOW.getTime() + 10 * DAY));
    const admin = await actor();
    const m = metricsResponseSchema.parse(
      (await call(admin.cookie, 'GET', '/api/admin/metrics?period=7d')).json(),
    );
    expect(m.series).toHaveLength(7);
    expect(m.series.at(-1)?.date).toBe('2026-03-12');
  });
});
