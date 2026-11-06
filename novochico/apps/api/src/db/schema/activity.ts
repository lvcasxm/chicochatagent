import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { FEEDBACK_SUGGESTION_MAX_LENGTH } from '@chicochat/shared';
import { analyticsEventType } from './enums';
import { conversations } from './conversations';
import { createdAt, lit, pk, tstz } from './helpers';
import { ticketAttempts } from './tickets';
import { users } from './users';

/** Avaliação do atendimento: no máximo uma por conversa. */
export const feedbacks = pgTable(
  'feedbacks',
  {
    id: pk(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    ticketAttemptId: uuid('ticket_attempt_id').references(() => ticketAttempts.id),
    rating: integer('rating').notNull(),
    suggestion: text('suggestion'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('feedbacks_conversation_key').on(t.conversationId),
    check('feedbacks_rating_range', sql`${t.rating} between 1 and 5`),
    check(
      'feedbacks_suggestion_length',
      sql`char_length(${t.suggestion}) <= ${lit(FEEDBACK_SUGGESTION_MAX_LENGTH)}`,
    ),
  ],
);

/** Eventos gerados pelo servidor. Os metadados nunca levam conteúdo nem dados pessoais. */
export const analyticsEvents = pgTable(
  'analytics_events',
  {
    id: pk(),
    eventType: analyticsEventType('event_type').notNull(),
    userId: uuid('user_id').references(() => users.id),
    conversationId: uuid('conversation_id').references(() => conversations.id),
    attendanceSessionId: uuid('attendance_session_id'),
    category: text('category'),
    sector: text('sector'),
    metadata: jsonb('metadata')
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: createdAt(),
  },
  (t) => [
    index('analytics_events_type_created_idx').on(t.eventType, t.createdAt),
    index('analytics_events_created_at_idx').on(t.createdAt),
    index('analytics_events_conversation_idx').on(t.conversationId),
  ],
);

/** Cache de respostas do primeiro turno (H.7). A chave inclui a versão do prompt. */
export const aiResponseCache = pgTable(
  'ai_response_cache',
  {
    id: pk(),
    cacheKey: text('cache_key').notNull(),
    response: text('response').notNull(),
    hits: integer('hits').notNull().default(0),
    expiresAt: tstz('expires_at').notNull(),
    lastHitAt: tstz('last_hit_at').notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('ai_response_cache_key').on(t.cacheKey),
    index('ai_response_cache_expires_idx').on(t.expiresAt),
  ],
);

/** Registro de ações sensíveis. A aplicação só insere; nunca atualiza nem apaga. */
export const auditLog = pgTable(
  'audit_log',
  {
    id: pk(),
    actorId: uuid('actor_id').references(() => users.id),
    action: text('action').notNull(),
    targetType: text('target_type'),
    targetId: text('target_id'),
    metadata: jsonb('metadata')
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: createdAt(),
  },
  (t) => [
    index('audit_log_created_at_idx').on(t.createdAt),
    index('audit_log_actor_idx').on(t.actorId, t.createdAt),
    index('audit_log_action_idx').on(t.action, t.createdAt),
  ],
);
