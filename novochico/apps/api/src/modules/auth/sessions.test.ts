import { createHash } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sessions, users } from '../../db/schema';
import { createClock, DAY, HOUR, insertUser, MINUTE } from '../../../test/auth-helpers';
import { createTestDatabase, TEST_DATABASE_URL, type TestDatabase } from '../../../test/db';
import { createUsers } from '../users';
import {
  createSessionService,
  SESSION_ABSOLUTE_TIMEOUT_MS,
  SESSION_IDLE_TIMEOUT_MS,
} from './sessions';

// Precisa do PostgreSQL do Compose (`npm run db:up`) e de TEST_DATABASE_URL no .env.
describe.skipIf(!TEST_DATABASE_URL)('sessões', () => {
  let test: TestDatabase;
  const orm = () => test.db.orm;
  const clock = createClock();

  function service() {
    return createSessionService({
      orm: orm(),
      users: createUsers({ orm: orm(), now: clock.now }),
      now: clock.now,
    });
  }

  beforeAll(async () => {
    test = await createTestDatabase();
  }, 30_000);

  afterAll(async () => {
    await test.drop();
  }, 30_000);

  beforeEach(async () => {
    clock.set(new Date('2026-03-02T12:00:00.000Z'));
    await orm().execute(sql`truncate table users restart identity cascade`);
  });

  it('o prazo configurado é de 8 horas de inatividade e 7 dias no total', () => {
    expect(SESSION_IDLE_TIMEOUT_MS).toBe(8 * HOUR);
    expect(SESSION_ABSOLUTE_TIMEOUT_MS).toBe(7 * DAY);
  });

  describe('criação', () => {
    it('gera um identificador aleatório de 43 caracteres e guarda só o hash', async () => {
      const user = await insertUser(orm());
      const { token, expiresAt } = await service().create(user.id);

      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(expiresAt).toEqual(new Date(clock.now().getTime() + 7 * DAY));

      const rows = await orm().select().from(sessions);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.tokenHash).toBe(createHash('sha256').update(token).digest('hex'));
      expect(rows[0]?.tokenHash).not.toContain(token);
    });

    it('cada login gera um identificador novo', async () => {
      const user = await insertUser(orm());
      const first = await service().create(user.id);
      const second = await service().create(user.id);
      expect(first.token).not.toBe(second.token);
    });
  });

  describe('autenticação', () => {
    it('aceita um identificador válido e devolve o usuário', async () => {
      const user = await insertUser(orm(), { role: 'tecnico' });
      const { token } = await service().create(user.id);

      const session = await service().authenticate(token);

      expect(session?.user).toMatchObject({ id: user.id, role: 'tecnico', email: user.email });
      expect(session?.sessionId).toBeTruthy();
    });

    it('rejeita identificadores malformados, vazios e desconhecidos', async () => {
      for (const token of [
        '',
        'curto',
        'a'.repeat(42),
        'a'.repeat(44),
        `${'a'.repeat(42)}!`,
        'a'.repeat(43),
      ]) {
        expect(await service().authenticate(token), token).toBeNull();
      }
    });

    it('rejeita o hash no lugar do identificador', async () => {
      const user = await insertUser(orm());
      await service().create(user.id);
      const [row] = await orm().select().from(sessions);
      expect(await service().authenticate(row?.tokenHash ?? '')).toBeNull();
    });

    it('lê o papel do banco a cada requisição, sem guardar uma cópia desatualizada', async () => {
      const user = await insertUser(orm());
      const { token } = await service().create(user.id);
      expect((await service().authenticate(token))?.user.role).toBe('user');

      await orm().update(users).set({ role: 'admin' }).where(eq(users.id, user.id));

      expect((await service().authenticate(token))?.user.role).toBe('admin');
    });
  });

  describe('revogação', () => {
    it('uma sessão revogada deixa de valer na hora', async () => {
      const user = await insertUser(orm());
      const { token } = await service().create(user.id);
      const session = await service().authenticate(token);

      await service().revoke(session!.sessionId);

      expect(await service().authenticate(token)).toBeNull();
    });

    it('revogar uma sessão não afeta as outras do mesmo usuário', async () => {
      const user = await insertUser(orm());
      const first = await service().create(user.id);
      const second = await service().create(user.id);
      const firstSession = await service().authenticate(first.token);

      await service().revoke(firstSession!.sessionId);

      expect(await service().authenticate(first.token)).toBeNull();
      expect(await service().authenticate(second.token)).not.toBeNull();
    });

    it('uma conta desativada perde a sessão, mesmo sem revogá-la', async () => {
      const user = await insertUser(orm());
      const { token } = await service().create(user.id);
      await orm().update(users).set({ disabledAt: clock.now() }).where(eq(users.id, user.id));
      expect(await service().authenticate(token)).toBeNull();
    });
  });

  describe('expiração por inatividade', () => {
    it('vale logo abaixo de 8 horas sem uso e deixa de valer em 8 horas', async () => {
      const user = await insertUser(orm());
      const { token } = await service().create(user.id);

      clock.advance(8 * HOUR - MINUTE);
      expect(await service().authenticate(token)).not.toBeNull();
    });

    it('deixa de valer depois de 8 horas sem uso', async () => {
      const user = await insertUser(orm());
      const { token } = await service().create(user.id);

      clock.advance(8 * HOUR);
      expect(await service().authenticate(token)).toBeNull();
    });

    it('o uso estende a sessão: cada acesso reinicia a contagem de inatividade', async () => {
      const user = await insertUser(orm());
      const { token } = await service().create(user.id);

      // Acessa a cada 7 horas durante um dia e meio: nunca passa de 8 horas parada.
      for (let step = 0; step < 5; step++) {
        clock.advance(7 * HOUR);
        expect(await service().authenticate(token), `passo ${step}`).not.toBeNull();
      }
    });

    it('só atualiza a última atividade a cada minuto, para não gravar em toda requisição', async () => {
      const user = await insertUser(orm());
      const { token } = await service().create(user.id);
      const lastSeen = async () => (await orm().select().from(sessions))[0]?.lastSeenAt;
      const created = clock.now();

      clock.advance(30 * 1000);
      await service().authenticate(token);
      expect(await lastSeen()).toEqual(created);

      clock.advance(31 * 1000);
      await service().authenticate(token);
      expect(await lastSeen()).toEqual(clock.now());
    });
  });

  describe('expiração absoluta', () => {
    it('acaba em 7 dias mesmo com uso contínuo', async () => {
      const user = await insertUser(orm());
      const { token } = await service().create(user.id);

      // Uso a cada 6 horas durante quase toda a semana: segue valendo.
      for (let step = 0; step < 27; step++) {
        clock.advance(6 * HOUR);
        expect(await service().authenticate(token), `passo ${step}`).not.toBeNull();
      }
      // 27 x 6h = 6 dias e 18 horas. Mais 6 horas passa de 7 dias.
      clock.advance(6 * HOUR);
      expect(await service().authenticate(token)).toBeNull();
    });
  });
});
