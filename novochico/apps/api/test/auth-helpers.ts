import type { OrmClient } from '../src/db/client';
import { users } from '../src/db/schema';

let counter = 0;

/** Cria um usuário direto no banco, para testes que não passam pelo login. */
export async function insertUser(
  orm: OrmClient,
  overrides: Partial<typeof users.$inferInsert> = {},
): Promise<typeof users.$inferSelect> {
  counter += 1;
  const [row] = await orm
    .insert(users)
    .values({
      email: `servidor${counter}@prefeitura.example.test`,
      fullName: `Servidor ${counter}`,
      googleSub: `google-sub-${counter}`,
      ...overrides,
    })
    .returning();
  if (!row) throw new Error('Falha ao criar usuário de teste');
  return row;
}

/** Relógio controlável: os testes avançam o tempo sem esperar. */
export function createClock(start = '2026-03-02T12:00:00.000Z') {
  let current = new Date(start);
  return {
    now: () => current,
    advance(ms: number) {
      current = new Date(current.getTime() + ms);
    },
    set(value: Date) {
      current = value;
    },
  };
}

export const MINUTE = 60 * 1000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;
