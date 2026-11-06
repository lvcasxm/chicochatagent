import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { INSTRUCTIONS_MAX_LENGTH } from '@chicochat/shared';
import { categoryAction, instructionStatus } from './enums';
import { createdAt, lit, pk, tstz, updatedAt } from './helpers';
import { users } from './users';

/** Cards da tela inicial (Anexo C). As regras de atendimento ficam em `instruction_versions`. */
export const categories = pgTable(
  'categories',
  {
    id: pk(),
    key: text('key').notNull(),
    title: text('title').notNull(),
    cardDescription: text('card_description'),
    icon: text('icon'),
    action: categoryAction('action').notNull().default('chat'),
    externalUrl: text('external_url'),
    secondaryLinkLabel: text('secondary_link_label'),
    secondaryLinkUrl: text('secondary_link_url'),
    /** Mensagem enviada ao clicar no card (só para `action = 'chat'`). */
    cannedMessage: text('canned_message'),
    /** Rótulo curto usado como título provisório da conversa. */
    shortLabel: text('short_label'),
    sortOrder: integer('sort_order').notNull().default(0),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('categories_key_key').on(t.key),
    check(
      'categories_link_has_url',
      sql`${t.action} <> 'external_link' or ${t.externalUrl} is not null`,
    ),
  ],
);

/**
 * Instruções de atendimento do agente, versionadas (ADR-030). No máximo uma versão publicada
 * e um rascunho por vez. Versões nunca são apagadas.
 */
export const instructionVersions = pgTable(
  'instruction_versions',
  {
    id: pk(),
    version: integer('version').notNull(),
    status: instructionStatus('status').notNull(),
    content: text('content').notNull(),
    /** Pedido original em linguagem natural; nulo em edição manual. */
    changeRequest: text('change_request'),
    changeSummary: text('change_summary'),
    aiConflicts: jsonb('ai_conflicts'),
    /** Nulo na versão 1, criada pelo seed. */
    createdBy: uuid('created_by').references(() => users.id),
    publishedBy: uuid('published_by').references(() => users.id),
    publishedAt: tstz('published_at'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('instruction_versions_version_key').on(t.version),
    uniqueIndex('instruction_versions_single_published')
      .on(t.status)
      .where(sql`${t.status} = 'published'`),
    uniqueIndex('instruction_versions_single_draft')
      .on(t.status)
      .where(sql`${t.status} = 'draft'`),
    check(
      'instruction_versions_content_length',
      sql`char_length(${t.content}) between 1 and ${lit(INSTRUCTIONS_MAX_LENGTH)}`,
    ),
    // Marcadores técnicos (<<...>>) são sinais fixos do código e não podem estar no documento.
    check('instruction_versions_no_markers', sql`position('<<' in ${t.content}) = 0`),
    check(
      'instruction_versions_published_has_date',
      sql`${t.status} = 'draft' or ${t.publishedAt} is not null`,
    ),
  ],
);
