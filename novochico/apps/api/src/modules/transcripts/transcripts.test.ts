import { createHash } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  PRIVACY_NOTICE_VERSION,
  myTicketsResponseSchema,
  transcriptResponseSchema,
  type UserRole,
} from '@chicochat/shared';
import { createApp } from '../../app';
import {
  auditLog,
  conversations,
  messages,
  ticketAttempts,
  ticketTranscripts,
} from '../../db/schema';
import { seedDatabase } from '../../db/seed';
import { createScriptedLlm } from '../../integrations/gemini/fake';
import type { LlmClient } from '../../integrations/gemini/llm';
import { createFakeGlpi, type FakeGlpiOptions } from '../../integrations/glpi/fake';
import { GlpiError, type GlpiClient, type GlpiTicket } from '../../integrations/glpi/glpi';
import { createClock, insertUser } from '../../../test/auth-helpers';
import { createTestDatabase, TEST_DATABASE_URL, type TestDatabase } from '../../../test/db';
import { captureLogger, testConfig } from '../../../test/helpers';
import { createSessionService } from '../auth/sessions';
import { SUMMARY_SECTIONS } from '../tickets/summary';
import { createUsers } from '../users';

const ORIGIN = testConfig.appOrigin;
const SECTIONS = SUMMARY_SECTIONS.map((name) => `${name}:\nTexto de ${name}.`).join('\n\n');
const LLM_SUMMARY = {
  titulo: 'Internet do setor caiu',
  descricao: SECTIONS,
  categoria: 'Rede e internet',
  urgencia: 4,
};
const BODY = { sector: 'Secretaria de Saúde', machineIp: '10.1.2.30' };
let keyCounter = 0;
const newKey = () => `chave-f6-${String(++keyCounter).padStart(6, '0')}`;

// Precisa do PostgreSQL do Compose (`npm run db:up`) e de TEST_DATABASE_URL no .env.
describe.skipIf(!TEST_DATABASE_URL)('Meus chamados e transcrição', () => {
  let test: TestDatabase;
  let app: FastifyInstance;
  const orm = () => test.db.orm;
  const clock = createClock();
  const log = captureLogger();

  let glpiFake = createFakeGlpi();
  const existing: Array<GlpiTicket & { requesterId: number }> = [];
  const setGlpi = (options: FakeGlpiOptions = {}) => {
    existing.length = 0;
    glpiFake = createFakeGlpi({ existing, ...options });
    return glpiFake;
  };
  const glpiProxy: GlpiClient = {
    findRequesterId: (e) => glpiFake.client.findRequesterId(e),
    createTicket: (i) => glpiFake.client.createTicket(i),
    attachRequester: (id, r) => glpiFake.client.attachRequester(id, r),
    listTickets: (id) => glpiFake.client.listTickets(id),
    getTicket: (id) => glpiFake.client.getTicket(id),
  };
  let summary = createScriptedLlm([], [LLM_SUMMARY]);
  const summaryProxy: LlmClient = {
    streamChat: (i) => summary.client.streamChat(i),
    generateJson: (i) => summary.client.generateJson(i),
  };

  beforeAll(async () => {
    test = await createTestDatabase();
    await seedDatabase(orm());
    app = await createApp({
      config: testConfig,
      logger: log.logger,
      db: test.db,
      oidc: null,
      llm: createScriptedLlm([]).client,
      summaryLlm: summaryProxy,
      glpi: glpiProxy,
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
    setGlpi();
    summary = createScriptedLlm(
      [],
      Array.from({ length: 8 }, () => LLM_SUMMARY),
    );
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

  async function conversationOf(who: Actor, withMessages = true) {
    const [row] = await orm()
      .insert(conversations)
      .values({ userId: who.user.id, ticketFormUnlockedAt: clock.now() })
      .returning();
    if (!row) throw new Error('conversa não criada');
    if (withMessages) {
      const base = clock.now().getTime();
      await orm()
        .insert(messages)
        .values([
          {
            conversationId: row.id,
            role: 'user',
            content: 'A internet caiu no setor',
            createdAt: new Date(base - 5000),
          },
          {
            conversationId: row.id,
            role: 'assistant',
            content: 'Qual o equipamento?',
            source: 'llm',
            createdAt: new Date(base - 4000),
          },
        ]);
    }
    return row.id;
  }

  async function open(who: Actor, conversationId: string, body: Record<string, unknown> = BODY) {
    return app.inject({
      method: 'POST',
      url: `/api/conversations/${conversationId}/tickets`,
      headers: { ...headers(who), 'idempotency-key': newKey() },
      payload: body,
    });
  }

  /** Abre um chamado e devolve o token da transcrição que foi para o texto do chamado no GLPI. */
  async function openAndGetToken(who: Actor) {
    const response = await open(who, await conversationOf(who));
    expect(response.statusCode).toBe(201);
    const content = glpiFake.tickets.at(-1)?.content ?? '';
    const match = /\/conversa\/([A-Za-z0-9_-]{43})/.exec(content);
    return {
      token: match?.[1] ?? '',
      content,
      ticketId: (response.json() as { ticketId: string }).ticketId,
    };
  }

  const mine = async (who: Actor) => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/tickets/mine',
      headers: headers(who),
    });
    expect(response.statusCode).toBe(200);
    return myTicketsResponseSchema.parse(response.json());
  };
  const transcript = (who: Actor | null, token: string) =>
    app.inject({
      method: 'GET',
      url: `/api/transcripts/${token}`,
      headers: who ? headers(who) : {},
    });

  describe('GET /api/tickets/mine', () => {
    it('lista os chamados abertos pelo sistema, com status, urgência e descrição em texto', async () => {
      const who = await actor();
      await openAndGetToken(who);
      const result = await mine(who);
      expect(result.notice).toBeNull();
      expect(result.tickets).toHaveLength(1);
      expect(result.tickets[0]).toMatchObject({
        id: '1000',
        title: 'Internet do setor caiu',
        statusLabel: 'Novo',
        urgencyLabel: 'Alta',
      });
      expect(result.tickets[0]?.description).toContain('Solicitante: Maria Silva Santos');
    });

    it('o usuário A nunca lista os chamados do usuário B', async () => {
      const a = await actor();
      const b = await actor();
      await openAndGetToken(a);
      await openAndGetToken(b);
      const listA = await mine(a);
      const listB = await mine(b);
      expect(listA.tickets.map((t) => t.id)).toEqual(['1000']);
      expect(listB.tickets.map((t) => t.id)).toEqual(['1001']);
    });

    it('a listagem usa só o e-mail da sessão: parâmetros da URL são ignorados', async () => {
      const a = await actor();
      const b = await actor();
      await openAndGetToken(b);
      const response = await app.inject({
        method: 'GET',
        url: `/api/tickets/mine?email=${encodeURIComponent(b.user.email)}&userId=${b.user.id}&requester=7`,
        headers: headers(a),
      });
      expect(myTicketsResponseSchema.parse(response.json()).tickets).toEqual([]);
      expect(glpiFake.lookups.at(-1)).toBe(a.user.email);
    });

    it('inclui chamados do GLPI abertos por outros meios, do mais recente ao mais antigo', async () => {
      const who = await actor();
      const requesterId = (await glpiFake.client.findRequesterId(who.user.email)) ?? 0;
      existing.push(
        {
          requesterId,
          id: '300',
          title: 'Teclado quebrado',
          statusId: 4,
          createdAt: '2026-02-20 08:00:00',
          updatedAt: '2026-02-21 08:00:00',
          urgency: 2,
          content: 'Trocar teclado',
        },
        {
          requesterId,
          id: '301',
          title: 'Monitor piscando',
          statusId: 6,
          createdAt: '2026-02-25 08:00:00',
          updatedAt: '2026-02-26 08:00:00',
          urgency: 3,
          content: null,
        },
      );
      await openAndGetToken(who);
      const result = await mine(who);
      expect(result.tickets.map((t) => t.id)).toEqual(['1000', '301', '300']);
      expect(result.tickets.find((t) => t.id === '300')).toMatchObject({
        statusLabel: 'Pendente',
        urgencyLabel: 'Baixa',
        createdAt: '2026-02-20T11:00:00.000Z', // 08:00 em São Paulo
      });
      expect(result.tickets.find((t) => t.id === '301')?.description).toBeNull();
    });

    it.each([
      [1, 'Novo'],
      [2, 'Em atendimento'],
      [3, 'Em atendimento'],
      [4, 'Pendente'],
      [5, 'Solucionado'],
      [6, 'Fechado'],
      [9, null],
    ])('status %i aparece como %s', async (statusId, label) => {
      const who = await actor();
      const requesterId = (await glpiFake.client.findRequesterId(who.user.email)) ?? 0;
      existing.push({
        requesterId,
        id: '10',
        title: 't',
        statusId,
        createdAt: '2026-02-20 08:00:00',
        updatedAt: null,
        urgency: null,
        content: null,
      });
      expect((await mine(who)).tickets[0]?.statusLabel).toBe(label);
    });

    it('XSS: a descrição vem do GLPI como texto plano, sem marca nem atributo', async () => {
      const who = await actor();
      const requesterId = (await glpiFake.client.findRequesterId(who.user.email)) ?? 0;
      existing.push({
        requesterId,
        id: '66',
        title: 'Chamado com conteúdo hostil',
        statusId: 1,
        createdAt: '2026-02-20 08:00:00',
        updatedAt: null,
        urgency: 3,
        content:
          '&lt;img src=x onerror=alert(1)&gt;&lt;p&gt;Olá &lt;b&gt;equipe&lt;/b&gt;&lt;/p&gt;<script>alert(2)</script>',
      });
      const response = await app.inject({
        method: 'GET',
        url: '/api/tickets/mine',
        headers: headers(who),
      });
      const result = myTicketsResponseSchema.parse(response.json());
      expect(result.tickets[0]?.description).toBe('Olá equipe');
      expect(response.body).not.toMatch(/onerror|<script|<img|alert\(/);
    });

    it('sem cadastro no GLPI: aviso próprio e o que há no registro local', async () => {
      const who = await actor();
      await openAndGetToken(who);
      setGlpi({ requester: 'missing' });
      const result = await mine(who);
      expect(result.notice).toBe('requester_not_found');
      expect(result.tickets).toHaveLength(1);
      expect(result.tickets[0]).toMatchObject({ id: '1000', statusLabel: null, description: null });
    });

    it('GLPI fora do ar: aviso próprio e o registro local, sem detalhe técnico', async () => {
      const who = await actor();
      await openAndGetToken(who);
      setGlpi({ readFails: new GlpiError('GLPI_SERVER', { httpStatus: 500 }) });
      const response = await app.inject({
        method: 'GET',
        url: '/api/tickets/mine',
        headers: headers(who),
      });
      expect(response.statusCode).toBe(200);
      const result = myTicketsResponseSchema.parse(response.json());
      expect(result.notice).toBe('glpi_unavailable');
      expect(result.tickets.map((t) => t.id)).toEqual(['1000']);
      expect(response.body).not.toMatch(/GLPI_SERVER|500/);
    });

    it('falha ao buscar o solicitante também vira aviso, não erro', async () => {
      const who = await actor();
      setGlpi({ requester: 'error' });
      expect((await mine(who)).notice).toBe('glpi_unavailable');
    });

    it('um chamado registrado que o GLPI não devolve cai para o registro local', async () => {
      const who = await actor();
      await openAndGetToken(who);
      // O GLPI "perdeu" o chamado: a listagem vem vazia e a busca individual também.
      setGlpi();
      await glpiFake.client.findRequesterId(who.user.email);
      const result = await mine(who);
      expect(result.tickets.map((t) => t.id)).toEqual(['1000']);
      expect(result.tickets[0]?.statusLabel).toBeNull();
    });

    it('o registro local não traz chamados de teste nem os que falharam', async () => {
      const admin = await actor('admin');
      await open(admin, await conversationOf(admin), { ...BODY, testMode: true });
      setGlpi({ createFails: new GlpiError('GLPI_SERVER') });
      await open(admin, await conversationOf(admin));
      expect(await orm().select().from(ticketAttempts)).toHaveLength(2);
      // Com o GLPI fora do ar só há o registro local, e nele nenhum dos dois entra.
      setGlpi({ readFails: new GlpiError('GLPI_SERVER') });
      const result = await mine(admin);
      expect(result.notice).toBe('glpi_unavailable');
      expect(result.tickets).toEqual([]);
    });

    it('sem login: 401; sem aceite da privacidade: 403', async () => {
      expect((await app.inject({ method: 'GET', url: '/api/tickets/mine' })).statusCode).toBe(401);
      const who = await actor('user', { privacy: false });
      expect(
        (await app.inject({ method: 'GET', url: '/api/tickets/mine', headers: headers(who) }))
          .statusCode,
      ).toBe(403);
    });
  });

  describe('transcrição: criação', () => {
    it('o chamado leva o link da conversa completa, com um token de 256 bits', async () => {
      const who = await actor();
      const { token, content } = await openAndGetToken(who);
      expect(token).toHaveLength(43);
      expect(content).toContain(`**Visualizar conversa completa:** ${ORIGIN}/conversa/${token}`);
      expect(content.trimEnd().endsWith(`/conversa/${token}`)).toBe(true);
    });

    it('só o hash do token fica no banco', async () => {
      const who = await actor();
      const { token } = await openAndGetToken(who);
      const rows = await orm().select().from(ticketTranscripts);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.tokenHash).toBe(createHash('sha256').update(token).digest('hex'));
      expect(JSON.stringify(rows)).not.toContain(token);
    });

    it('é um retrato do momento da abertura: mensagens novas não o alteram', async () => {
      const who = await actor();
      const { token } = await openAndGetToken(who);
      const [conversation] = await orm().select().from(conversations);
      await orm()
        .insert(messages)
        .values({
          conversationId: conversation?.id ?? '',
          role: 'user',
          content: 'MENSAGEM-POSTERIOR',
        });
      const body = transcriptResponseSchema.parse((await transcript(who, token)).json());
      expect(body.messages.map((m) => m.content)).toEqual([
        'A internet caiu no setor',
        'Qual o equipamento?',
      ]);
    });

    it('chamado de teste e conversa sem mensagens não geram transcrição nem link', async () => {
      const admin = await actor('admin');
      await open(admin, await conversationOf(admin), { ...BODY, testMode: true });
      const who = await actor();
      await open(who, await conversationOf(who, false));
      expect(glpiFake.tickets.every((t) => !t.content.includes('/conversa/'))).toBe(true);
      expect(await orm().select().from(ticketTranscripts)).toHaveLength(0);
    });

    it('falha definitiva na abertura não deixa a conversa guardada; resultado desconhecido mantém', async () => {
      setGlpi({ createFails: new GlpiError('GLPI_SERVER') });
      const who = await actor();
      await open(who, await conversationOf(who));
      expect(await orm().select().from(ticketTranscripts)).toHaveLength(0);

      setGlpi({ createFails: new GlpiError('GLPI_TIMEOUT') });
      await open(who, await conversationOf(who));
      expect(await orm().select().from(ticketTranscripts)).toHaveLength(1);
    });
  });

  describe('transcrição: acesso', () => {
    it('o dono lê, com o rótulo de cada fala e o resumo do chamado', async () => {
      const who = await actor();
      const { token, ticketId } = await openAndGetToken(who);
      const response = await transcript(who, token);
      expect(response.statusCode).toBe(200);
      const body = transcriptResponseSchema.parse(response.json());
      expect(body).toMatchObject({
        ticketId,
        title: 'Internet do setor caiu',
        requesterName: 'Maria Silva Santos',
        sector: 'Secretaria de Saúde',
      });
      expect(body.summary).toBe(
        SECTIONS.replace('Contexto:\n', 'Contexto:\nSolicitante: Maria Silva Santos. Setor: Secretaria de Saúde. IP da máquina: 10.1.2.30.\n'),
      );
      expect(body.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
      expect(response.body).not.toContain(who.user.email);
    });

    it.each(['tecnico', 'admin'] as const)(
      '%s lê a transcrição de outra pessoa, e o acesso é auditado',
      async (role) => {
        const owner = await actor();
        const staff = await actor(role);
        const { token } = await openAndGetToken(owner);
        expect((await transcript(staff, token)).statusCode).toBe(200);
        const audit = await orm()
          .select()
          .from(auditLog)
          .where(eq(auditLog.action, 'transcript.view'));
        expect(audit).toHaveLength(1);
        expect(audit[0]).toMatchObject({ actorId: staff.user.id, targetType: 'transcript' });
        expect(audit[0]?.metadata).toEqual({ role, owner: false });
        expect(JSON.stringify(audit[0])).not.toMatch(/A internet caiu|@prefeitura|Maria/);
      },
    );

    it('cada acesso gera um registro, inclusive o do dono', async () => {
      const owner = await actor();
      const { token } = await openAndGetToken(owner);
      await transcript(owner, token);
      await transcript(owner, token);
      const audit = await orm()
        .select()
        .from(auditLog)
        .where(eq(auditLog.action, 'transcript.view'));
      expect(audit).toHaveLength(2);
      expect(audit[0]?.metadata).toEqual({ role: 'user', owner: true });
    });

    it('outro usuário comum recebe a mesma resposta de uma transcrição inexistente', async () => {
      const owner = await actor();
      const other = await actor();
      const { token } = await openAndGetToken(owner);
      const forbidden = await transcript(other, token);
      const missing = await transcript(other, 'A'.repeat(43));
      const malformed = await transcript(other, 'curto');
      for (const response of [forbidden, missing, malformed]) expect(response.statusCode).toBe(404);
      expect(forbidden.json()).toEqual(missing.json());
      expect(forbidden.json()).toEqual(malformed.json());
      expect(
        await orm().select().from(auditLog).where(eq(auditLog.action, 'transcript.view')),
      ).toHaveLength(0);
    });

    it('sem login: 401 (a tela leva ao login e volta); sem aceite da privacidade: 403', async () => {
      const owner = await actor();
      const { token } = await openAndGetToken(owner);
      expect((await transcript(null, token)).statusCode).toBe(401);
      const noPrivacy = await actor('tecnico', { privacy: false });
      expect((await transcript(noPrivacy, token)).statusCode).toBe(403);
    });

    it('tentar adivinhar tokens não revela nada nem gera auditoria', async () => {
      const who = await actor('admin');
      for (const token of [
        'x'.repeat(43),
        '0'.repeat(43),
        'a'.repeat(42),
        'a'.repeat(44),
        '../../etc/passwd',
      ]) {
        expect((await transcript(who, token)).statusCode, token).toBe(404);
      }
      expect(
        await orm().select().from(auditLog).where(eq(auditLog.action, 'transcript.view')),
      ).toHaveLength(0);
    });
  });
});
