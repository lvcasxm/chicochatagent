import { sql } from 'drizzle-orm';
import { timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * Número como literal SQL. Um `${n}` solto em `check()` ou em `where()` vira parâmetro de
 * consulta (`$1`), que o PostgreSQL não aceita em DDL.
 */
export const lit = (value: number) => sql.raw(String(value));

/** Padrões da seção F.1: `id uuid` com `gen_random_uuid()` e datas `timestamptz`. */
export const pk = () => uuid('id').primaryKey().defaultRandom();

export const tstz = (name: string) => timestamp(name, { withTimezone: true });

export const createdAt = () => tstz('created_at').notNull().defaultNow();

export const updatedAt = () => tstz('updated_at').notNull().defaultNow();
