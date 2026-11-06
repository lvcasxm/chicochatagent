import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  aiResponseCache,
  analyticsEvents,
  categories,
  conversations,
  feedbacks,
  instructionVersions,
  messages,
  sessions,
  ticketAttempts,
  ticketTranscripts,
  users,
} from './schema';
import {
  createTestDatabase,
  expectPgError,
  PG,
  TEST_DATABASE_URL,
  type TestDatabase,
} from '../../test/db';

// Precisa do PostgreSQL do Compose (`npm run db:up`) e de TEST_DATABASE_URL no .env.
describe.skipIf(!TEST_DATABASE_URL)('restrições do banco', () => {
  let test: TestDatabase;
  const orm = () => test.db.orm;
  let counter = 0;

  beforeAll(async () => {
    test = await createTestDatabase();
  }, 30_000);

  afterAll(async () => {
    await test.drop();
  }, 30_000);

  beforeEach(async () => {
    await orm().execute(
      sql`truncate table users, categories, instruction_versions, ai_response_cache,
          audit_log, analytics_events restart identity cascade`,
    );
  });

  async function newUser(overrides: Partial<typeof users.$inferInsert> = {}) {
    counter += 1;
    const [row] = await orm()
      .insert(users)
      .values({
        email: `servidor${counter}@example.test`,
        fullName: 'Servidor de Teste',
        googleSub: `sub-${counter}`,
        ...overrides,
      })
      .returning();
    if (!row) throw new Error('Falha ao criar usuário de teste');
    return row;
  }

  async function newConversation(userId: string) {
    const [row] = await orm().insert(conversations).values({ userId }).returning();
    if (!row) throw new Error('Falha ao criar conversa de teste');
    return row;
  }

  function attempt(
    conversationId: string,
    userId: string,
    overrides: Partial<typeof ticketAttempts.$inferInsert> = {},
  ): typeof ticketAttempts.$inferInsert {
    return {
      conversationId,
      userId,
      idempotencyKey: 'chave-1',
      requesterName: 'Servidor de Teste',
      requesterEmail: 'servidor@example.test',
      sector: 'Setor de Teste',
      machineIp: '10.0.0.10',
      ...overrides,
    };
  }

  describe('users e sessions', () => {
    it('o papel padrão é "user"', async () => {
      expect((await newUser()).role).toBe('user');
    });

    it('rejeita papel inexistente', async () => {
      await expectPgError(
        orm().execute(
          sql`insert into users (email, full_name, role, google_sub)
              values ('a@example.test', 'A', 'root', 'sub-x')`,
        ),
        PG.invalidEnumValue,
      );
    });

    it('rejeita e-mail com maiúsculas e e-mail duplicado', async () => {
      await expectPgError(newUser({ email: 'Servidor@Example.test' }), PG.checkViolation);
      await newUser({ email: 'igual@example.test' });
      await expectPgError(newUser({ email: 'igual@example.test' }), PG.uniqueViolation);
    });

    it('rejeita o mesmo google_sub em duas contas', async () => {
      await newUser({ googleSub: 'mesma-conta' });
      await expectPgError(newUser({ googleSub: 'mesma-conta' }), PG.uniqueViolation);
    });

    it('exige data e versão do aviso de privacidade juntas', async () => {
      await expectPgError(newUser({ privacyAckAt: new Date() }), PG.checkViolation);
      await expectPgError(newUser({ privacyAckVersion: 'v1' }), PG.checkViolation);
      await newUser({ privacyAckAt: new Date(), privacyAckVersion: 'v1' });
    });

    it('rejeita token de sessão repetido e apaga as sessões com o usuário', async () => {
      const user = await newUser();
      const expiresAt = new Date(Date.now() + 3_600_000);
      await orm().insert(sessions).values({ userId: user.id, tokenHash: 'hash-1', expiresAt });
      await expectPgError(
        orm().insert(sessions).values({ userId: user.id, tokenHash: 'hash-1', expiresAt }),
        PG.uniqueViolation,
      );
      await orm().delete(users).where(eq(users.id, user.id));
      expect(await orm().select().from(sessions)).toHaveLength(0);
    });
  });

  describe('conversations e messages', () => {
    it('limita o título a 80 caracteres', async () => {
      const user = await newUser();
      await orm()
        .insert(conversations)
        .values({ userId: user.id, title: 'a'.repeat(80) });
      await expectPgError(
        orm()
          .insert(conversations)
          .values({ userId: user.id, title: 'a'.repeat(81) }),
        PG.checkViolation,
      );
    });

    it('não aceita tentativas negativas', async () => {
      const user = await newUser();
      await expectPgError(
        orm().insert(conversations).values({ userId: user.id, resolutionAttempts: -1 }),
        PG.checkViolation,
      );
    });

    it('mensagem do usuário não pode ter origem; a do assistente pode', async () => {
      const user = await newUser();
      const conversation = await newConversation(user.id);
      await expectPgError(
        orm()
          .insert(messages)
          .values({ conversationId: conversation.id, role: 'user', content: 'oi', source: 'llm' }),
        PG.checkViolation,
      );
      await orm()
        .insert(messages)
        .values({ conversationId: conversation.id, role: 'user', content: 'oi' });
      await orm().insert(messages).values({
        conversationId: conversation.id,
        role: 'assistant',
        content: 'olá',
        source: 'llm',
      });
    });

    it('limita o conteúdo a 20.000 caracteres', async () => {
      const user = await newUser();
      const conversation = await newConversation(user.id);
      await orm()
        .insert(messages)
        .values({ conversationId: conversation.id, role: 'user', content: 'a'.repeat(20_000) });
      await expectPgError(
        orm()
          .insert(messages)
          .values({ conversationId: conversation.id, role: 'user', content: 'a'.repeat(20_001) }),
        PG.checkViolation,
      );
    });

    it('apaga as mensagens junto com a conversa', async () => {
      const user = await newUser();
      const conversation = await newConversation(user.id);
      await orm()
        .insert(messages)
        .values({ conversationId: conversation.id, role: 'user', content: 'oi' });
      await orm().delete(conversations).where(eq(conversations.id, conversation.id));
      expect(await orm().select().from(messages)).toHaveLength(0);
    });

    it('não deixa apagar um usuário que tem conversas', async () => {
      const user = await newUser();
      await newConversation(user.id);
      await expectPgError(orm().delete(users).where(eq(users.id, user.id)), '23503');
    });
  });

  describe('ticket_attempts', () => {
    it('começa pendente e aceita o caso comum', async () => {
      const user = await newUser();
      const conversation = await newConversation(user.id);
      const [row] = await orm()
        .insert(ticketAttempts)
        .values(attempt(conversation.id, user.id))
        .returning();
      expect(row?.status).toBe('pending');
      expect(row?.isTest).toBe(false);
    });

    it('exige IP ou a declaração de que não há acesso, nunca os dois nem nenhum', async () => {
      const user = await newUser();
      const c = await newConversation(user.id);
      await expectPgError(
        orm()
          .insert(ticketAttempts)
          .values(attempt(c.id, user.id, { machineIp: '10.0.0.10', ipUnavailable: true })),
        PG.checkViolation,
      );
      await expectPgError(
        orm()
          .insert(ticketAttempts)
          .values(attempt(c.id, user.id, { machineIp: null, ipUnavailable: false })),
        PG.checkViolation,
      );
      await orm()
        .insert(ticketAttempts)
        .values(attempt(c.id, user.id, { machineIp: null, ipUnavailable: true }));
    });

    it('exige nome e setor do atendido quando o chamado é em nome de outra pessoa', async () => {
      const user = await newUser();
      const c = await newConversation(user.id);
      await expectPgError(
        orm()
          .insert(ticketAttempts)
          .values(attempt(c.id, user.id, { onBehalf: true, beneficiaryName: 'Fulana' })),
        PG.checkViolation,
      );
      await orm()
        .insert(ticketAttempts)
        .values(
          attempt(c.id, user.id, {
            onBehalf: true,
            beneficiaryName: 'Fulana',
            beneficiarySector: 'Secretaria de Teste',
          }),
        );
    });

    it('aceita urgência de 1 a 5 ou nula e rejeita o resto', async () => {
      const user = await newUser();
      const c = await newConversation(user.id);
      for (const [index, urgency] of [1, 3, 5, null].entries()) {
        await orm()
          .insert(ticketAttempts)
          .values(attempt(c.id, user.id, { idempotencyKey: `urgencia-${index}`, urgency }));
      }
      for (const urgency of [0, 6]) {
        await expectPgError(
          orm()
            .insert(ticketAttempts)
            .values(attempt(c.id, user.id, { idempotencyKey: `ruim-${urgency}`, urgency })),
          PG.checkViolation,
        );
      }
    });

    it('um sucesso precisa do número do chamado no GLPI', async () => {
      const user = await newUser();
      const c = await newConversation(user.id);
      await expectPgError(
        orm()
          .insert(ticketAttempts)
          .values(attempt(c.id, user.id, { status: 'success', glpiTicketId: null })),
        PG.checkViolation,
      );
      await orm()
        .insert(ticketAttempts)
        .values(attempt(c.id, user.id, { status: 'success', glpiTicketId: '4321' }));
    });

    it('impede repetir a chave de idempotência na mesma conversa, mas não em outra', async () => {
      const user = await newUser();
      const first = await newConversation(user.id);
      const second = await newConversation(user.id);
      await orm().insert(ticketAttempts).values(attempt(first.id, user.id));
      await expectPgError(
        orm().insert(ticketAttempts).values(attempt(first.id, user.id)),
        PG.uniqueViolation,
      );
      await orm().insert(ticketAttempts).values(attempt(second.id, user.id));
    });

    it('a transcrição é única por tentativa e o token também', async () => {
      const user = await newUser();
      const c = await newConversation(user.id);
      const [a1] = await orm()
        .insert(ticketAttempts)
        .values(attempt(c.id, user.id, { idempotencyKey: 'a' }))
        .returning();
      const [a2] = await orm()
        .insert(ticketAttempts)
        .values(attempt(c.id, user.id, { idempotencyKey: 'b' }))
        .returning();
      if (!a1 || !a2) throw new Error('Falha ao criar tentativas de teste');

      await orm().insert(ticketTranscripts).values({ ticketAttemptId: a1.id, tokenHash: 'h1' });
      await expectPgError(
        orm().insert(ticketTranscripts).values({ ticketAttemptId: a1.id, tokenHash: 'h2' }),
        PG.uniqueViolation,
      );
      await expectPgError(
        orm().insert(ticketTranscripts).values({ ticketAttemptId: a2.id, tokenHash: 'h1' }),
        PG.uniqueViolation,
      );
      const [row] = await orm().select().from(ticketTranscripts).limit(1);
      expect(row?.messages).toEqual([]);
    });
  });

  describe('feedbacks', () => {
    it('só aceita nota de 1 a 5', async () => {
      const user = await newUser();
      const c = await newConversation(user.id);
      for (const rating of [0, 6]) {
        await expectPgError(
          orm().insert(feedbacks).values({ conversationId: c.id, userId: user.id, rating }),
          PG.checkViolation,
        );
      }
      await orm().insert(feedbacks).values({ conversationId: c.id, userId: user.id, rating: 5 });
    });

    it('permite uma avaliação por conversa', async () => {
      const user = await newUser();
      const c = await newConversation(user.id);
      await orm().insert(feedbacks).values({ conversationId: c.id, userId: user.id, rating: 4 });
      await expectPgError(
        orm().insert(feedbacks).values({ conversationId: c.id, userId: user.id, rating: 5 }),
        PG.uniqueViolation,
      );
    });

    it('limita a sugestão a 1000 caracteres', async () => {
      const user = await newUser();
      const c = await newConversation(user.id);
      await expectPgError(
        orm()
          .insert(feedbacks)
          .values({
            conversationId: c.id,
            userId: user.id,
            rating: 3,
            suggestion: 'a'.repeat(1001),
          }),
        PG.checkViolation,
      );
    });
  });

  describe('categories', () => {
    it('rejeita chave repetida', async () => {
      await orm().insert(categories).values({ key: 'rede', title: 'Rede' });
      await expectPgError(
        orm().insert(categories).values({ key: 'rede', title: 'Outra' }),
        PG.uniqueViolation,
      );
    });

    it('um card de link externo precisa de endereço', async () => {
      await expectPgError(
        orm().insert(categories).values({ key: 'a', title: 'A', action: 'external_link' }),
        PG.checkViolation,
      );
      await orm().insert(categories).values({
        key: 'b',
        title: 'B',
        action: 'external_link',
        externalUrl: 'https://example.test',
      });
    });

    it('rejeita ação inexistente', async () => {
      await expectPgError(
        orm().execute(
          sql`insert into categories (key, title, action) values ('c', 'C', 'explodir')`,
        ),
        PG.invalidEnumValue,
      );
    });
  });

  describe('instruction_versions', () => {
    const draft = (version: number) => ({
      version,
      status: 'draft' as const,
      content: `Instruções ${version}`,
    });
    const published = (version: number) => ({
      version,
      status: 'published' as const,
      content: `Instruções ${version}`,
      publishedAt: new Date(),
    });

    it('aceita uma publicada e um rascunho ao mesmo tempo', async () => {
      await orm().insert(instructionVersions).values(published(1));
      await orm().insert(instructionVersions).values(draft(2));
    });

    it('rejeita uma segunda versão publicada', async () => {
      await orm().insert(instructionVersions).values(published(1));
      await expectPgError(
        orm().insert(instructionVersions).values(published(2)),
        PG.uniqueViolation,
      );
    });

    it('rejeita um segundo rascunho', async () => {
      await orm().insert(instructionVersions).values(draft(1));
      await expectPgError(orm().insert(instructionVersions).values(draft(2)), PG.uniqueViolation);
    });

    it('aceita várias versões arquivadas', async () => {
      for (const version of [1, 2, 3]) {
        await orm()
          .insert(instructionVersions)
          .values({ ...published(version), status: 'archived' });
      }
      expect(await orm().select().from(instructionVersions)).toHaveLength(3);
    });

    it('rejeita número de versão repetido', async () => {
      await orm()
        .insert(instructionVersions)
        .values({ ...published(1), status: 'archived' });
      await expectPgError(orm().insert(instructionVersions).values(draft(1)), PG.uniqueViolation);
    });

    it('rejeita marcador técnico no conteúdo', async () => {
      await expectPgError(
        orm()
          .insert(instructionVersions)
          .values({ ...draft(1), content: 'Quando precisar, emita <<ALGO>> no fim.' }),
        PG.checkViolation,
      );
    });

    it('rejeita conteúdo vazio ou acima de 20.000 caracteres', async () => {
      await expectPgError(
        orm()
          .insert(instructionVersions)
          .values({ ...draft(1), content: '' }),
        PG.checkViolation,
      );
      await expectPgError(
        orm()
          .insert(instructionVersions)
          .values({ ...draft(1), content: 'a'.repeat(20_001) }),
        PG.checkViolation,
      );
      await orm()
        .insert(instructionVersions)
        .values({ ...draft(1), content: 'a'.repeat(20_000) });
    });

    it('uma versão publicada precisa da data de publicação', async () => {
      await expectPgError(
        orm().insert(instructionVersions).values({ version: 1, status: 'published', content: 'x' }),
        PG.checkViolation,
      );
    });

    it('publicar é possível em uma transação: arquiva a atual e publica o rascunho', async () => {
      await orm().insert(instructionVersions).values(published(1));
      await orm().insert(instructionVersions).values(draft(2));
      await orm().transaction(async (tx) => {
        await tx
          .update(instructionVersions)
          .set({ status: 'archived' })
          .where(eq(instructionVersions.status, 'published'));
        await tx
          .update(instructionVersions)
          .set({ status: 'published', publishedAt: new Date() })
          .where(eq(instructionVersions.status, 'draft'));
      });
      const rows = await orm()
        .select()
        .from(instructionVersions)
        .orderBy(instructionVersions.version);
      expect(rows.map((row) => row.status)).toEqual(['archived', 'published']);
    });
  });

  describe('analytics_events, cache e auditoria', () => {
    it('rejeita tipo de evento desconhecido e usa metadados vazios por padrão', async () => {
      await expectPgError(
        orm().execute(sql`insert into analytics_events (event_type) values ('evento_inventado')`),
        PG.invalidEnumValue,
      );
      const [row] = await orm()
        .insert(analyticsEvents)
        .values({ eventType: 'conversation_started' })
        .returning();
      expect(row?.metadata).toEqual({});
    });

    it('rejeita chave de cache repetida', async () => {
      const expiresAt = new Date(Date.now() + 86_400_000);
      await orm().insert(aiResponseCache).values({ cacheKey: 'k', response: 'r', expiresAt });
      await expectPgError(
        orm().insert(aiResponseCache).values({ cacheKey: 'k', response: 'r2', expiresAt }),
        PG.uniqueViolation,
      );
    });
  });
});
