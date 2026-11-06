import { eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  PRIVACY_NOTICE_VERSION,
  bootstrapResponseSchema,
  createTicketResponseSchema,
  ticketCheckResponseSchema,
  type UserRole,
} from '@chicochat/shared';
import { createApp } from '../../app';
import { analyticsEvents, conversations, messages, ticketAttempts, users } from '../../db/schema';
import { seedDatabase } from '../../db/seed';
import { createScriptedLlm } from '../../integrations/gemini/fake';
import { LlmError, type LlmClient } from '../../integrations/gemini/llm';
import { createFakeGlpi, type FakeGlpiOptions } from '../../integrations/glpi/fake';
import { GlpiError, type GlpiClient } from '../../integrations/glpi/glpi';
import { createClock, insertUser, MINUTE } from '../../../test/auth-helpers';
import { createTestDatabase, TEST_DATABASE_URL, type TestDatabase } from '../../../test/db';
import { captureLogger, testConfig } from '../../../test/helpers';
import { createSessionService } from '../auth/sessions';
import { createUsers } from '../users';
import { SUMMARY_SECTIONS } from './summary';

const ORIGIN = testConfig.appOrigin;
const SECTIONS = SUMMARY_SECTIONS.map((name) => `${name}:\nTexto de ${name}.`).join('\n\n');
const LLM_SUMMARY = {
  titulo: 'Internet do setor de Saúde caiu',
  descricao: SECTIONS,
  categoria: 'Outra coisa?',
  urgencia: 4,
};
const BODY = { sector: 'Secretaria de Saúde', machineIp: '10.1.2.30' };

let keyCounter = 0;
const newKey = () => `chave-teste-${String(++keyCounter).padStart(6, '0')}`;

// Precisa do PostgreSQL do Compose (`npm run db:up`) e de TEST_DATABASE_URL no .env.
describe.skipIf(!TEST_DATABASE_URL)('chamados: abertura no GLPI', () => {
  let test: TestDatabase;
  let app: FastifyInstance;
  const orm = () => test.db.orm;
  const clock = createClock();
  const log = captureLogger();

  let glpiFake = createFakeGlpi();
  let glpiOn: GlpiClient | null = glpiFake.client;
  const setGlpi = (options: FakeGlpiOptions = {}) => {
    glpiFake = createFakeGlpi(options);
    glpiOn = glpiFake.client;
    return glpiFake;
  };
  const glpiProxy: GlpiClient = {
    findRequesterId: (email) => (glpiOn ?? glpiFake.client).findRequesterId(email),
    createTicket: (input) => (glpiOn ?? glpiFake.client).createTicket(input),
    attachRequester: (id, requester) => (glpiOn ?? glpiFake.client).attachRequester(id, requester),
  };

  let summary: ReturnType<typeof createScriptedLlm> = createScriptedLlm([], []);
  const setSummary = (json: unknown[]) => {
    summary = createScriptedLlm([], json);
    return summary;
  };
  const summaryProxy: LlmClient = {
    streamChat: (input) => summary.client.streamChat(input),
    generateJson: (input) => summary.client.generateJson(input),
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
    setSummary([LLM_SUMMARY]);
  });

  const sessionService = () =>
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
    const { token } = await sessionService().create(user.id);
    return { user, cookie: `chico_session=${token}` };
  }
  type Actor = Awaited<ReturnType<typeof actor>>;
  const headers = (who: Actor, extra: Record<string, string> = {}) => ({
    cookie: who.cookie,
    origin: ORIGIN,
    ...extra,
  });

  /** Conversa do usuário, já liberada para abrir chamado (a menos que se peça o contrário). */
  async function conversationOf(
    who: Actor,
    options: { unlocked?: boolean; categoryKey?: string | null; userMessage?: string } = {},
  ) {
    const [row] = await orm()
      .insert(conversations)
      .values({
        userId: who.user.id,
        categoryKey: options.categoryKey ?? null,
        ...(options.unlocked === false ? {} : { ticketFormUnlockedAt: clock.now() }),
      })
      .returning();
    if (!row) throw new Error('conversa não criada');
    const base = clock.now().getTime();
    await orm()
      .insert(messages)
      .values([
        {
          conversationId: row.id,
          role: 'user',
          content: options.userMessage ?? 'A internet caiu em todo o setor desde cedo',
          createdAt: new Date(base - 5000),
        },
        {
          conversationId: row.id,
          role: 'assistant',
          content: 'RESPOSTA-DO-BOT-NA-TRANSCRICAO',
          source: 'llm',
          createdAt: new Date(base - 4000),
        },
      ]);
    return row.id;
  }

  async function open(
    who: Actor,
    conversationId: string,
    body: Record<string, unknown> = BODY,
    key: string | null = newKey(),
  ) {
    const response = await app.inject({
      method: 'POST',
      url: `/api/conversations/${conversationId}/tickets`,
      headers: headers(who, key === null ? {} : { 'idempotency-key': key }),
      payload: body,
    });
    return {
      response,
      status: response.statusCode,
      body: response.json() as Record<string, unknown>,
    };
  }

  const attempts = () => orm().select().from(ticketAttempts);
  const events = (type: string) =>
    orm()
      .select()
      .from(analyticsEvents)
      .where(eq(analyticsEvents.eventType, type as 'ticket_created'));

  describe('liberação e papéis', () => {
    it('sem a liberação do servidor: 403, e nada é enviado ao GLPI', async () => {
      const who = await actor();
      const id = await conversationOf(who, { unlocked: false });
      const { status, body } = await open(who, id);
      expect(status).toBe(403);
      expect((body.error as { code: string }).code).toBe('TICKET_NOT_UNLOCKED');
      expect(glpiFake.creates()).toBe(0);
      expect(await attempts()).toHaveLength(0);
    });

    it('o administrador abre sem a triagem (bypass), mas é chamado real', async () => {
      const admin = await actor('admin');
      const id = await conversationOf(admin, { unlocked: false });
      const { status } = await open(admin, id);
      expect(status).toBe(201);
      expect(glpiFake.tickets).toHaveLength(1);
      expect((await attempts())[0]?.isTest).toBe(false);
    });

    it('técnico não tem o bypass', async () => {
      const tecnico = await actor('tecnico');
      const id = await conversationOf(tecnico, { unlocked: false });
      expect((await open(tecnico, id)).status).toBe(403);
    });

    it('modo de teste só para administrador', async () => {
      const who = await actor('user');
      const id = await conversationOf(who);
      const { status } = await open(who, id, { ...BODY, testMode: true });
      expect(status).toBe(403);
      expect(glpiFake.creates()).toBe(0);
    });

    it('conversa de outro usuário, inexistente ou id inválido: 404', async () => {
      const owner = await actor();
      const other = await actor();
      const id = await conversationOf(owner);
      for (const target of [id, '3f9a1c52-8d4e-4b7a-9c1e-2a6b5d8e0f13', 'nao-uuid']) {
        expect((await open(other, target)).status).toBe(404);
      }
      expect(glpiFake.creates()).toBe(0);
    });

    it('GLPI não configurado: 503 com mensagem segura', async () => {
      const who = await actor();
      const id = await conversationOf(who);
      glpiOn = null;
      // O app foi criado com o proxy; sem GLPI real configurado, use outro app.
      const bare = await createApp({
        config: testConfig,
        logger: log.logger,
        db: test.db,
        oidc: null,
        llm: null,
        summaryLlm: null,
        glpi: null,
        now: clock.now,
      });
      await bare.ready();
      try {
        const response = await bare.inject({
          method: 'POST',
          url: `/api/conversations/${id}/tickets`,
          headers: headers(who, { 'idempotency-key': newKey() }),
          payload: BODY,
        });
        expect(response.statusCode).toBe(503);
        expect((response.json() as { error: { code: string } }).error.code).toBe(
          'GLPI_UNAVAILABLE',
        );
      } finally {
        await bare.close();
      }
    });

    it('sem login: 401; sem aceite da privacidade: 403', async () => {
      const who = await actor('user', { privacy: false });
      const id = await conversationOf(who);
      const anonymous = await app.inject({
        method: 'POST',
        url: `/api/conversations/${id}/tickets`,
        headers: { origin: ORIGIN, 'idempotency-key': newKey() },
        payload: BODY,
      });
      expect(anonymous.statusCode).toBe(401);
      expect((await open(who, id)).status).toBe(403);
    });
  });

  describe('identidade e validação', () => {
    it('nome e e-mail vêm da sessão; o corpo não aceita esses campos', async () => {
      const who = await actor();
      const id = await conversationOf(who);
      for (const extra of [
        { requesterName: 'Outra Pessoa' },
        { requesterEmail: 'outra@prefeitura.example.test' },
        { email: 'x@y.test' },
        { name: 'x' },
        { userId: who.user.id },
      ]) {
        expect((await open(who, id, { ...BODY, ...extra })).status).toBe(422);
      }
      expect(glpiFake.creates()).toBe(0);

      expect((await open(who, id)).status).toBe(201);
      const [saved] = await attempts();
      expect(saved).toMatchObject({
        userId: who.user.id,
        requesterName: 'Maria Silva Santos',
        requesterEmail: who.user.email,
      });
      expect(glpiFake.tickets[0]?.content).toContain(
        `**Solicitante:** Maria Silva Santos (${who.user.email})`,
      );
      expect(glpiFake.lookups).toEqual([who.user.email]);
    });

    it.each([
      ['sem IP e sem "não tenho acesso"', { sector: 'Saúde' }],
      [
        'IP e "não tenho acesso" ao mesmo tempo',
        { sector: 'Saúde', machineIp: '10.1.2.30', ipUnavailable: true },
      ],
      ['setor curto demais', { sector: 'S', machineIp: '10.1.2.30' }],
      ['sem setor', { machineIp: '10.1.2.30' }],
      ['em nome de outra pessoa sem nome', { ...BODY, onBehalf: true, beneficiarySector: 'Obras' }],
      ['em nome de outra pessoa sem unidade', { ...BODY, onBehalf: true, beneficiaryName: 'João' }],
    ])('corpo inválido: %s → 422', async (_name, body) => {
      const who = await actor();
      const id = await conversationOf(who);
      expect((await open(who, id, body)).status).toBe(422);
      expect(glpiFake.creates()).toBe(0);
    });

    it.each(['10.1.2', '1.2.3.4', '10.1.2.300', '10.1.2.3.4', 'abc', '10.1.2.30 ', '10.10.2.30'])(
      'IP "%s" fora do formato: 422 INVALID_IP',
      async (machineIp) => {
        const who = await actor();
        const id = await conversationOf(who);
        const { status, body } = await open(who, id, { sector: 'Saúde', machineIp });
        if (machineIp === '10.1.2.30 ') {
          // Espaços nas pontas são aparados antes de validar.
          expect(status).toBe(201);
          return;
        }
        expect(status).toBe(422);
        expect((body.error as { code: string }).code).toMatch(/INVALID_IP|INVALID_INPUT/);
      },
    );

    it('exige o cabeçalho Idempotency-Key, com formato válido', async () => {
      const who = await actor();
      const id = await conversationOf(who);
      for (const key of [null, '', 'curta', 'tem espaço na chave', 'x'.repeat(101)]) {
        expect((await open(who, id, BODY, key)).status, String(key)).toBe(422);
      }
      expect(glpiFake.creates()).toBe(0);
    });

    it('"sem acesso ao IP" gera o texto próprio no chamado', async () => {
      const who = await actor();
      const id = await conversationOf(who);
      const { status } = await open(who, id, { sector: 'Saúde', ipUnavailable: true });
      expect(status).toBe(201);
      expect(glpiFake.tickets[0]?.content).toContain(
        'Não informado — usuário sem acesso à máquina',
      );
      const [saved] = await attempts();
      expect(saved).toMatchObject({ machineIp: null, ipUnavailable: true });
    });

    it('em nome de outra pessoa: bloco do atendido no chamado e no registro', async () => {
      const who = await actor();
      const id = await conversationOf(who);
      const { status } = await open(who, id, {
        ...BODY,
        onBehalf: true,
        beneficiaryName: 'João Souza',
        beneficiaryRegistration: '12345',
        beneficiarySector: 'Obras',
      });
      expect(status).toBe(201);
      expect(glpiFake.tickets[0]?.content).toContain('**Nome do atendido:** João Souza');
      expect(glpiFake.tickets[0]?.content).toContain('**Matrícula:** 12345');
      // O solicitante continua sendo quem está logado.
      expect(glpiFake.tickets[0]?.content).toContain(`(${who.user.email})`);
      expect((await attempts())[0]).toMatchObject({
        onBehalf: true,
        beneficiaryName: 'João Souza',
      });
    });
  });

  describe('abertura com sucesso', () => {
    it('cria o chamado com o resumo da IA, liga o solicitante e registra tudo', async () => {
      const who = await actor();
      const id = await conversationOf(who);
      const { status, body } = await open(who, id);
      expect(status).toBe(201);
      const parsed = createTicketResponseSchema.parse(body);
      expect(parsed).toEqual({
        status: 'success',
        ticketId: '1000',
        title: 'Internet do setor de Saúde caiu',
        message: 'Chamado nº 1000 aberto.',
      });

      const [ticket] = glpiFake.tickets;
      expect(ticket).toMatchObject({
        title: 'Internet do setor de Saúde caiu',
        urgency: 4,
        requesterId: 7,
      });
      expect(ticket?.content).toContain('**Setor do solicitante:** Secretaria de Saúde');
      expect(ticket?.content).toContain('**IP da máquina:** 10.1.2.30');
      expect(ticket?.content).toContain('**Categoria:** Outra coisa?');
      expect(ticket?.content).toContain(SECTIONS);
      expect(ticket?.content).not.toContain('RESPOSTA-DO-BOT');
      expect(glpiFake.attached).toEqual([{ ticketId: '1000', requesterId: 7 }]);

      const [saved] = await attempts();
      expect(saved).toMatchObject({
        status: 'success',
        glpiTicketId: '1000',
        glpiRequesterId: 7,
        summarySource: 'llm',
        urgency: 4,
        category: 'Outra coisa?',
        sector: 'Secretaria de Saúde',
        isTest: false,
        errorCode: null,
      });

      const [conversation] = await orm()
        .select()
        .from(conversations)
        .where(eq(conversations.id, id));
      expect(conversation).toMatchObject({ outcome: 'escalated', sector: 'Secretaria de Saúde' });
      const notices = await orm().select().from(messages).where(eq(messages.role, 'notice'));
      expect(notices.map((m) => m.content)).toEqual(['Chamado nº 1000 aberto.']);
      expect(await events('ticket_created')).toHaveLength(1);
    });

    it('a mensagem de sucesso não promete retorno nem notificação (B-13)', async () => {
      const who = await actor();
      const { body } = await open(who, await conversationOf(who));
      expect(JSON.stringify(body)).not.toMatch(
        /entrar[aá] em contato|notificad|já foi|prazo|retorno/i,
      );
    });

    it('a IA recebe o setor e a conversa, e a categoria do card é respeitada (RF-041)', async () => {
      const who = await actor();
      const id = await conversationOf(who, { categoryKey: 'network' });
      await open(who, id);
      const [call] = summary.jsonCalls;
      expect(call?.user).toContain('Setor do usuário: Secretaria de Saúde');
      expect(call?.user).toContain('USUÁRIO: A internet caiu em todo o setor desde cedo');
      expect(call?.user).toContain('BOT: RESPOSTA-DO-BOT-NA-TRANSCRICAO');
      expect((await attempts())[0]?.category).toBe('Rede e internet');
      expect(glpiFake.tickets[0]?.content).toContain('**Categoria:** Rede e internet');
    });

    it('solicitante não encontrado no GLPI não bloqueia o chamado', async () => {
      setGlpi({ requester: 'missing' });
      const who = await actor();
      expect((await open(who, await conversationOf(who))).status).toBe(201);
      expect(glpiFake.attached).toHaveLength(0);
      expect((await attempts())[0]?.glpiRequesterId).toBeNull();
    });

    it('falha na busca do solicitante e no vínculo são só avisos', async () => {
      setGlpi({ requester: 'error', attachFails: true });
      const who = await actor();
      expect((await open(who, await conversationOf(who))).status).toBe(201);
      setGlpi({ attachFails: true });
      const other = await actor();
      expect((await open(other, await conversationOf(other))).status).toBe(201);
      expect(glpiFake.tickets).toHaveLength(1);
    });
  });

  describe('resumo: contingência', () => {
    it('sem IA do resumo, usa a contingência, sem transcrição', async () => {
      const bare = await createApp({
        config: testConfig,
        logger: log.logger,
        db: test.db,
        oidc: null,
        llm: null,
        summaryLlm: null,
        glpi: glpiProxy,
        now: clock.now,
      });
      await bare.ready();
      try {
        const who = await actor();
        const id = await conversationOf(who);
        const response = await bare.inject({
          method: 'POST',
          url: `/api/conversations/${id}/tickets`,
          headers: headers(who, { 'idempotency-key': newKey() }),
          payload: BODY,
        });
        expect(response.statusCode).toBe(201);
        const [ticket] = glpiFake.tickets;
        expect(ticket?.title).toBe('Solicitação de suporte — Secretaria de Saúde');
        expect(ticket?.urgency).toBe(3);
        expect(ticket?.content).toContain(
          'Problema identificado:\nA internet caiu em todo o setor desde cedo',
        );
        expect(ticket?.content).not.toContain('RESPOSTA-DO-BOT');
        expect((await attempts())[0]).toMatchObject({
          summarySource: 'fallback',
          category: 'Suporte técnico geral',
        });
      } finally {
        await bare.close();
      }
    });

    it('três respostas inválidas da IA caem na contingência e o chamado abre', async () => {
      setSummary([{ titulo: 'só título' }, 'texto', null]);
      const who = await actor();
      const { status } = await open(who, await conversationOf(who));
      expect(status).toBe(201);
      expect(summary.jsonCalls).toHaveLength(3);
      expect((await attempts())[0]?.summarySource).toBe('fallback');
      expect(glpiFake.tickets[0]?.title).toBe('Solicitação de suporte — Secretaria de Saúde');
    }, 15_000);

    it('IA que falha na primeira e acerta na segunda: usa o resumo da IA', async () => {
      setSummary([new LlmError('unavailable'), LLM_SUMMARY]);
      const who = await actor();
      await open(who, await conversationOf(who));
      expect((await attempts())[0]?.summarySource).toBe('llm');
    }, 15_000);
  });

  describe('modo de teste (administrador)', () => {
    it('chamado de teste: sem IA, categoria "Teste", fora das métricas, da duplicidade e do setor', async () => {
      const admin = await actor('admin');
      const id = await conversationOf(admin);
      const { status } = await open(admin, id, { ...BODY, testMode: true });
      expect(status).toBe(201);
      expect(summary.jsonCalls).toHaveLength(0);
      expect(glpiFake.tickets[0]).toMatchObject({ title: 'Chamado de teste', urgency: 1 });
      expect(glpiFake.tickets[0]?.content).toContain('**Categoria:** Teste');
      expect((await attempts())[0]).toMatchObject({
        isTest: true,
        summarySource: 'test',
        category: 'Teste',
      });
      expect(await events('ticket_created')).toHaveLength(0);
      const [conversation] = await orm()
        .select()
        .from(conversations)
        .where(eq(conversations.id, id));
      expect(conversation?.outcome).toBeNull();

      // Não aparece como chamado parecido nem como último setor.
      const check = await app.inject({
        method: 'POST',
        url: `/api/conversations/${id}/ticket-check`,
        headers: headers(admin),
      });
      expect(ticketCheckResponseSchema.parse(check.json()).similar).toEqual([]);
    });
  });

  describe('idempotência', () => {
    it('a mesma chave devolve o mesmo resultado e nunca cria outro chamado', async () => {
      const who = await actor();
      const id = await conversationOf(who);
      const key = newKey();
      const first = await open(who, id, BODY, key);
      const second = await open(who, id, BODY, key);
      const third = await open(
        who,
        id,
        { ...BODY, sector: 'Outro setor completamente diferente' },
        key,
      );
      expect(first.status).toBe(201);
      expect(second.status).toBe(200);
      expect(third.status).toBe(200);
      expect(second.body).toEqual(first.body);
      expect(third.body).toEqual(first.body);
      expect(glpiFake.creates()).toBe(1);
      expect(await attempts()).toHaveLength(1);
    });

    it('chave nova na mesma conversa abre outro chamado', async () => {
      const who = await actor();
      const id = await conversationOf(who);
      setSummary([LLM_SUMMARY, LLM_SUMMARY]);
      await open(who, id);
      await open(who, id);
      expect(glpiFake.creates()).toBe(2);
    });

    it('a mesma chave em conversas diferentes é independente', async () => {
      const who = await actor();
      setSummary([LLM_SUMMARY, LLM_SUMMARY]);
      const key = newKey();
      await open(who, await conversationOf(who), BODY, key);
      await open(who, await conversationOf(who), BODY, key);
      expect(glpiFake.creates()).toBe(2);
    });

    it('requisições simultâneas com a mesma chave criam um chamado só', async () => {
      setGlpi({ createDelayMs: 200 });
      const who = await actor();
      const id = await conversationOf(who);
      const key = newKey();
      const results = await Promise.all(Array.from({ length: 6 }, () => open(who, id, BODY, key)));

      expect(glpiFake.creates()).toBe(1);
      expect(await attempts()).toHaveLength(1);
      const statuses = results.map((r) => r.status).sort();
      expect(statuses.filter((s) => s === 201)).toHaveLength(1);
      expect(statuses.every((s) => s === 201 || s === 409)).toBe(true);

      // Terminada a primeira, repetir devolve o resultado gravado.
      const replay = await open(who, id, BODY, key);
      expect(replay.status).toBe(200);
      expect(replay.body.ticketId).toBe('1000');
    });
  });

  describe('falhas do GLPI', () => {
    it.each([
      ['GLPI_UNAVAILABLE', 'failed'],
      ['GLPI_AUTH', 'failed'],
      ['GLPI_NOT_FOUND', 'failed'],
      ['GLPI_SERVER', 'failed'],
      ['GLPI_REJECTED', 'failed'],
      ['GLPI_TIMEOUT', 'unknown'],
      ['GLPI_BAD_RESPONSE', 'unknown'],
    ] as const)(
      '%s vira %s, com mensagem segura e registro da tentativa',
      async (code, expected) => {
        setGlpi({
          createFails: new GlpiError(code, {
            httpStatus: 500,
            cause: new Error('detalhe interno do glpi'),
          }),
        });
        const who = await actor();
        const id = await conversationOf(who);
        const { status, body } = await open(who, id);

        expect(status).toBe(200);
        const parsed = createTicketResponseSchema.parse(body);
        expect(parsed.status).toBe(expected);
        expect(parsed.ticketId).toBeNull();
        expect(parsed.message).toBe(
          expected === 'unknown'
            ? 'Não conseguimos confirmar a abertura. Confira em Meus chamados antes de tentar de novo.'
            : 'O sistema de chamados está indisponível. Você pode abrir o chamado direto pelo portal.',
        );
        expect(JSON.stringify(body)).not.toMatch(/glpi|detalhe interno|http|500/i);

        const [saved] = await attempts();
        expect(saved).toMatchObject({ status: expected, errorCode: code, glpiTicketId: null });
        expect(saved?.errorDetail).toBeTruthy();
        expect(await events('ticket_failed')).toHaveLength(1);
        expect(await orm().select().from(messages).where(eq(messages.role, 'notice'))).toHaveLength(
          0,
        );
        const [conversation] = await orm()
          .select()
          .from(conversations)
          .where(eq(conversations.id, id));
        expect(conversation?.outcome).toBeNull();
      },
    );

    it('timeout nunca reenvia sozinho; repetir a mesma chave devolve "desconhecido"', async () => {
      setGlpi({ createFails: new GlpiError('GLPI_TIMEOUT') });
      const who = await actor();
      const id = await conversationOf(who);
      const key = newKey();
      await open(who, id, BODY, key);
      const again = await open(who, id, BODY, key);
      expect(again.status).toBe(200);
      expect(again.body.status).toBe('unknown');
      expect(glpiFake.creates()).toBe(1);
    });

    it('depois de uma falha, uma chave nova (ação da pessoa) tenta de novo', async () => {
      let calls = 0;
      setGlpi({ createFails: () => (++calls === 1 ? new GlpiError('GLPI_SERVER') : null) });
      setSummary([LLM_SUMMARY, LLM_SUMMARY]);
      const who = await actor();
      const id = await conversationOf(who);
      expect((await open(who, id)).body.status).toBe('failed');
      const retry = await open(who, id);
      expect(retry.status).toBe(201);
      expect(retry.body.status).toBe('success');
      expect(await attempts()).toHaveLength(2);
    });

    it('os logs não levam e-mail, nome, conversa nem detalhe do chamado', async () => {
      setGlpi({ createFails: new GlpiError('GLPI_SERVER', { httpStatus: 500 }) });
      const who = await actor();
      await open(who, await conversationOf(who));
      const output = log.output();
      expect(output).toContain('GLPI_SERVER');
      expect(output).not.toContain(who.user.email);
      expect(output).not.toContain('Maria Silva Santos');
      expect(output).not.toContain('A internet caiu em todo o setor');
    });
  });

  describe('chamados parecidos', () => {
    async function pastTicket(
      who: Actor,
      title: string,
      overrides: Partial<typeof ticketAttempts.$inferInsert> = {},
    ) {
      const conversation = await conversationOf(who);
      const [row] = await orm()
        .insert(ticketAttempts)
        .values({
          conversationId: conversation,
          userId: who.user.id,
          idempotencyKey: newKey(),
          status: 'success',
          glpiTicketId: String(Math.floor(Math.random() * 9000) + 100),
          requesterName: 'x',
          requesterEmail: who.user.email,
          sector: 'Saúde',
          ipUnavailable: true,
          title,
          category: 'Rede e internet',
          createdAt: new Date(clock.now().getTime() - 30 * MINUTE),
          ...overrides,
        })
        .returning();
      return row;
    }

    const check = async (who: Actor, id: string) =>
      ticketCheckResponseSchema.parse(
        (
          await app.inject({
            method: 'POST',
            url: `/api/conversations/${id}/ticket-check`,
            headers: headers(who),
          })
        ).json(),
      );

    it('mostra os chamados do próprio usuário e registra o aviso exibido', async () => {
      const who = await actor();
      await pastTicket(who, 'Internet caiu no setor de Saúde');
      const id = await conversationOf(who, { categoryKey: 'network' });
      const result = await check(who, id);
      expect(result.similar).toHaveLength(1);
      expect(result.similar[0]).toMatchObject({
        title: 'Internet caiu no setor de Saúde',
        category: 'Rede e internet',
      });
      expect(result.similar[0]?.ageMinutes).toBe(30);
      expect(await events('ticket_duplicate_warning_shown')).toHaveLength(1);
    });

    it('nunca mostra chamados de outras pessoas, nem com texto idêntico', async () => {
      const mine = await actor();
      const other = await actor();
      await pastTicket(other, 'Internet caiu no setor de Saúde');
      const result = await check(mine, await conversationOf(mine));
      expect(result.similar).toEqual([]);
    });

    it('não considera chamados de teste, que falharam ou com mais de 7 dias', async () => {
      const who = await actor();
      await pastTicket(who, 'Internet caiu no setor de Saúde', { isTest: true });
      await pastTicket(who, 'Internet caiu no setor de Saúde', {
        status: 'failed',
        glpiTicketId: null,
      });
      await pastTicket(who, 'Internet caiu no setor de Saúde', {
        createdAt: new Date(clock.now().getTime() - 8 * 24 * 60 * MINUTE),
      });
      expect((await check(who, await conversationOf(who))).similar).toEqual([]);
    });

    it('incidente coletivo: só contagem e categoria, com 3 usuários diferentes', async () => {
      const mine = await actor();
      for (let i = 0; i < 3; i++) {
        const other = await actor();
        await pastTicket(other, `Internet caiu SEGREDO-ALHEIO-${i}`);
      }
      const id = await conversationOf(mine, { categoryKey: 'network' });
      const result = await check(mine, id);
      expect(result.collective).toEqual({ count: 3, category: 'Rede e internet', windowHours: 2 });
      expect(JSON.stringify(result)).not.toContain('SEGREDO-ALHEIO');
    });

    it('dois usuários não formam incidente coletivo', async () => {
      const mine = await actor();
      for (let i = 0; i < 2; i++) await pastTicket(await actor(), 'Internet caiu no setor');
      expect(
        (await check(mine, await conversationOf(mine, { categoryKey: 'network' }))).collective,
      ).toBeNull();
    });

    it('"Abrir mesmo assim" registra o evento de substituição', async () => {
      const who = await actor();
      await open(who, await conversationOf(who), { ...BODY, duplicateOverride: true });
      expect(await events('ticket_duplicate_overridden')).toHaveLength(1);
    });

    it('só o dono checa a própria conversa', async () => {
      const owner = await actor();
      const other = await actor();
      const id = await conversationOf(owner);
      const response = await app.inject({
        method: 'POST',
        url: `/api/conversations/${id}/ticket-check`,
        headers: headers(other),
      });
      expect(response.statusCode).toBe(404);
    });
  });

  describe('bootstrap', () => {
    it('traz o último setor usado em um chamado real', async () => {
      const who = await actor();
      const fetchSector = async () =>
        bootstrapResponseSchema.parse(
          (
            await app.inject({ method: 'GET', url: '/api/bootstrap', headers: headers(who) })
          ).json(),
        ).lastSector;
      expect(await fetchSector()).toBeNull();
      await open(who, await conversationOf(who), { ...BODY, sector: 'Secretaria de Educação' });
      expect(await fetchSector()).toBe('Secretaria de Educação');
    });
  });

  it('a tabela de usuários não foi alterada pelos chamados', async () => {
    const who = await actor();
    await open(who, await conversationOf(who));
    const [row] = await orm().select().from(users).where(eq(users.id, who.user.id));
    expect(row?.defaultSector).toBeNull();
  });
});
