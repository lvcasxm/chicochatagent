import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ANALYTICS_EVENT_TYPES,
  CATEGORY_ACTIONS,
  CONVERSATION_OUTCOMES,
  INSTRUCTION_STATUSES,
  MESSAGE_ROLES,
  MESSAGE_SOURCES,
  SUMMARY_SOURCES,
  TICKET_STATUSES,
  USER_ROLES,
} from '@chicochat/shared';
import { createTestDatabase, TEST_DATABASE_URL, type TestDatabase } from '../../test/db';
import { runMigrations } from './migrations';

const EXPECTED_TABLES = [
  'ai_response_cache',
  'analytics_events',
  'audit_log',
  'categories',
  'conversations',
  'feedbacks',
  'instruction_versions',
  'messages',
  'sessions',
  'ticket_attempts',
  'ticket_transcripts',
  'users',
];

// Precisa do PostgreSQL do Compose (`npm run db:up`) e de TEST_DATABASE_URL no .env.
describe.skipIf(!TEST_DATABASE_URL)('migrations em banco limpo', () => {
  let test: TestDatabase;

  beforeAll(async () => {
    test = await createTestDatabase();
  }, 30_000);

  afterAll(async () => {
    await test.drop();
  }, 30_000);

  it('criam todas as tabelas do modelo', async () => {
    const result = await test.db.orm.execute<{ table_name: string }>(
      sql`select table_name from information_schema.tables
          where table_schema = 'public' and table_type = 'BASE TABLE'
          order by table_name`,
    );
    expect(result.rows.map((row) => row.table_name)).toEqual(EXPECTED_TABLES);
  });

  it('podem ser aplicadas de novo sem erro e sem repetir a migration', async () => {
    await runMigrations(test.db.orm);
    const result = await test.db.orm.execute<{ total: string }>(
      sql`select count(*)::text as total from drizzle.__drizzle_migrations`,
    );
    // Uma linha por migration existente (0000 e 0001).
    expect(result.rows[0]?.total).toBe('2');
  });

  it('criam os enums com exatamente os valores de @chicochat/shared', async () => {
    const result = await test.db.orm.execute<{ name: string; labels: string[] }>(
      sql`select t.typname as name, array_agg(e.enumlabel::text order by e.enumsortorder) as labels
          from pg_type t join pg_enum e on e.enumtypid = t.oid
          group by t.typname`,
    );
    const actual = Object.fromEntries(result.rows.map((row) => [row.name, row.labels]));
    expect(actual).toEqual({
      user_role: [...USER_ROLES],
      message_role: [...MESSAGE_ROLES],
      message_source: [...MESSAGE_SOURCES],
      conversation_outcome: [...CONVERSATION_OUTCOMES],
      ticket_status: [...TICKET_STATUSES],
      summary_source: [...SUMMARY_SOURCES],
      category_action: [...CATEGORY_ACTIONS],
      instruction_status: [...INSTRUCTION_STATUSES],
      analytics_event_type: [...ANALYTICS_EVENT_TYPES],
    });
  });

  it('criam os índices parciais e únicos previstos na seção F', async () => {
    const result = await test.db.orm.execute<{ indexname: string; indexdef: string }>(
      sql`select indexname, indexdef from pg_indexes where schemaname = 'public'`,
    );
    const byName = Object.fromEntries(result.rows.map((row) => [row.indexname, row.indexdef]));

    expect(byName['instruction_versions_single_published']).toMatch(/UNIQUE.*WHERE/);
    expect(byName['instruction_versions_single_draft']).toMatch(/UNIQUE.*WHERE/);
    expect(byName['conversations_user_recent_idx']).toMatch(/deleted_at IS NULL/);
    expect(byName['ticket_attempts_user_success_idx']).toMatch(/status.*success/);
    expect(byName['ticket_attempts_success_created_idx']).toMatch(/status.*success/);
    for (const name of [
      'ticket_attempts_idempotency_key',
      'feedbacks_conversation_key',
      'users_email_key',
      'users_google_sub_key',
      'categories_key_key',
      'messages_conversation_idx',
      'analytics_events_type_created_idx',
      'ai_response_cache_expires_idx',
    ]) {
      expect(byName[name], `índice ${name}`).toBeDefined();
    }
  });
});
