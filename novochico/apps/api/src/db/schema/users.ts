import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { userRole } from './enums';
import { createdAt, pk, tstz, updatedAt } from './helpers';

export const users = pgTable(
  'users',
  {
    id: pk(),
    email: text('email').notNull(),
    fullName: text('full_name').notNull(),
    role: userRole('role').notNull().default('user'),
    defaultSector: text('default_sector'),
    privacyAckAt: tstz('privacy_ack_at'),
    privacyAckVersion: text('privacy_ack_version'),
    /** Identificador estável da conta Google (claim `sub`). */
    googleSub: text('google_sub').notNull(),
    lastLoginAt: tstz('last_login_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    /** Exclusão lógica: conversas e chamados continuam referenciando o usuário (F.3). */
    disabledAt: tstz('disabled_at'),
  },
  (t) => [
    uniqueIndex('users_email_key').on(t.email),
    uniqueIndex('users_google_sub_key').on(t.googleSub),
    // Em vez de citext, mantém o e-mail sempre em minúsculas e único (ADR-033).
    check('users_email_lowercase', sql`${t.email} = lower(${t.email})`),
    check(
      'users_privacy_ack_pair',
      sql`(${t.privacyAckAt} is null) = (${t.privacyAckVersion} is null)`,
    ),
  ],
);

/** Sessão de login: só o hash do identificador é guardado (ADR-027). */
export const sessions = pgTable(
  'sessions',
  {
    id: pk(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    createdAt: createdAt(),
    expiresAt: tstz('expires_at').notNull(),
    lastSeenAt: tstz('last_seen_at').notNull().defaultNow(),
    revokedAt: tstz('revoked_at'),
  },
  (t) => [
    uniqueIndex('sessions_token_hash_key').on(t.tokenHash),
    index('sessions_user_id_idx').on(t.userId),
    index('sessions_expires_at_idx').on(t.expiresAt),
  ],
);
