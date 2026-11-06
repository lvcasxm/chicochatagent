import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { URGENCY_MAX, URGENCY_MIN } from '@chicochat/shared';
import { summarySource, ticketStatus } from './enums';
import { conversations } from './conversations';
import { createdAt, lit, pk, updatedAt } from './helpers';
import { users } from './users';

/**
 * Cada tentativa de abrir chamado no GLPI. Nasce `pending` e só muda uma vez, para
 * `success`, `failed` ou `unknown` (F.3). A categoria é texto, um retrato do momento.
 */
export const ticketAttempts = pgTable(
  'ticket_attempts',
  {
    id: pk(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    /** Impede criar dois chamados na mesma conversa em um reenvio (ADR-017). */
    idempotencyKey: text('idempotency_key').notNull(),
    status: ticketStatus('status').notNull().default('pending'),
    glpiTicketId: text('glpi_ticket_id'),
    /** Nulo em um sucesso significa que o solicitante não foi localizado no GLPI. */
    glpiRequesterId: integer('glpi_requester_id'),
    requesterName: text('requester_name').notNull(),
    requesterEmail: text('requester_email').notNull(),
    sector: text('sector').notNull(),
    machineIp: text('machine_ip'),
    ipUnavailable: boolean('ip_unavailable').notNull().default(false),
    onBehalf: boolean('on_behalf').notNull().default(false),
    beneficiaryName: text('beneficiary_name'),
    beneficiaryRegistration: text('beneficiary_registration'),
    beneficiarySector: text('beneficiary_sector'),
    title: text('title'),
    category: text('category'),
    urgency: integer('urgency'),
    summary: text('summary'),
    summarySource: summarySource('summary_source'),
    errorCode: text('error_code'),
    /** Detalhe técnico: vai só para log e auditoria, nunca para o usuário. */
    errorDetail: text('error_detail'),
    isTest: boolean('is_test').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('ticket_attempts_idempotency_key').on(t.conversationId, t.idempotencyKey),
    index('ticket_attempts_user_success_idx')
      .on(t.userId, t.createdAt.desc())
      .where(sql`${t.status} = 'success' and not ${t.isTest}`),
    index('ticket_attempts_success_created_idx')
      .on(t.createdAt)
      .where(sql`${t.status} = 'success'`),
    index('ticket_attempts_status_idx').on(t.status, t.createdAt),
    // Ou há IP, ou o usuário declarou não ter acesso à máquina; nunca os dois nem nenhum.
    check(
      'ticket_attempts_ip_xor',
      sql`(${t.ipUnavailable} and ${t.machineIp} is null) or (not ${t.ipUnavailable} and ${t.machineIp} is not null)`,
    ),
    check(
      'ticket_attempts_beneficiary_required',
      sql`not ${t.onBehalf} or (${t.beneficiaryName} is not null and ${t.beneficiarySector} is not null)`,
    ),
    check(
      'ticket_attempts_urgency_range',
      sql`${t.urgency} is null or ${t.urgency} between ${lit(URGENCY_MIN)} and ${lit(URGENCY_MAX)}`,
    ),
    check(
      'ticket_attempts_success_has_ticket',
      sql`${t.status} <> 'success' or ${t.glpiTicketId} is not null`,
    ),
  ],
);

/**
 * Retrato da conversa no momento da abertura, lido por quem atende o chamado (ADR-016).
 * Só o hash do token é guardado.
 */
export const ticketTranscripts = pgTable(
  'ticket_transcripts',
  {
    id: pk(),
    ticketAttemptId: uuid('ticket_attempt_id')
      .notNull()
      .references(() => ticketAttempts.id),
    tokenHash: text('token_hash').notNull(),
    title: text('title'),
    summary: text('summary'),
    requesterName: text('requester_name'),
    sector: text('sector'),
    messages: jsonb('messages')
      .notNull()
      .default(sql`'[]'::jsonb`),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('ticket_transcripts_attempt_key').on(t.ticketAttemptId),
    uniqueIndex('ticket_transcripts_token_hash_key').on(t.tokenHash),
  ],
);
