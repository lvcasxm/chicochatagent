import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { CONVERSATION_TITLE_MAX_LENGTH, MESSAGE_MAX_LENGTH } from '@chicochat/shared';
import { conversationOutcome, messageRole, messageSource } from './enums';
import { createdAt, lit, pk, tstz, updatedAt } from './helpers';
import { users } from './users';

export const conversations = pgTable(
  'conversations',
  {
    id: pk(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    title: text('title'),
    /** Categoria escolhida no card, guardada como texto para sobreviver a mudanças no catálogo. */
    categoryKey: text('category_key'),
    /** Sessão de atendimento de 30 min de inatividade (RN-32). */
    attendanceSessionId: uuid('attendance_session_id').notNull().defaultRandom(),
    resolutionAttempts: integer('resolution_attempts').notNull().default(0),
    /** Nulo = ainda não se sabe se o problema persiste. */
    issuePersists: boolean('issue_persists'),
    /** Preenchido quando a IA escala; sem isso o servidor recusa abrir chamado (ADR-012). */
    ticketFormUnlockedAt: tstz('ticket_form_unlocked_at'),
    /** O formulário foi liberado pelo atalho de teste do administrador (RF-025). */
    ticketFormTestMode: boolean('ticket_form_test_mode').notNull().default(false),
    resolvedAt: tstz('resolved_at'),
    finishedAt: tstz('finished_at'),
    outcome: conversationOutcome('outcome'),
    /** Último setor informado em um chamado desta conversa. */
    sector: text('sector'),
    lastMessageAt: tstz('last_message_at').notNull().defaultNow(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: tstz('deleted_at'),
  },
  (t) => [
    index('conversations_user_recent_idx')
      .on(t.userId, t.lastMessageAt.desc())
      .where(sql`${t.deletedAt} is null`),
    index('conversations_attendance_session_idx').on(t.attendanceSessionId),
    index('conversations_created_at_idx').on(t.createdAt),
    check(
      'conversations_title_length',
      sql`char_length(${t.title}) <= ${lit(CONVERSATION_TITLE_MAX_LENGTH)}`,
    ),
    check('conversations_attempts_nonnegative', sql`${t.resolutionAttempts} >= 0`),
  ],
);

export const messages = pgTable(
  'messages',
  {
    id: pk(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    role: messageRole('role').notNull(),
    content: text('content').notNull(),
    /** Nulo para mensagens do usuário. */
    source: messageSource('source'),
    /** Resposta interrompida no meio do stream (H.5). */
    incomplete: boolean('incomplete').notNull().default(false),
    model: text('model'),
    finishReason: text('finish_reason'),
    promptTokens: integer('prompt_tokens'),
    completionTokens: integer('completion_tokens'),
    /** Hash do prompt usado, para saber qual versão das instruções gerou a resposta. */
    promptVersion: text('prompt_version'),
    createdAt: createdAt(),
  },
  (t) => [
    index('messages_conversation_idx').on(t.conversationId, t.createdAt),
    index('messages_created_at_idx').on(t.createdAt),
    check('messages_content_length', sql`char_length(${t.content}) <= ${lit(MESSAGE_MAX_LENGTH)}`),
    check('messages_user_has_no_source', sql`${t.role} <> 'user' or ${t.source} is null`),
  ],
);
