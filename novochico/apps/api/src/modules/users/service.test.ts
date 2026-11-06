import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PRIVACY_NOTICE_VERSION } from '@chicochat/shared';
import { auditLog, users } from '../../db/schema';
import { AppError } from '../../lib/errors';
import { createClock, insertUser, MINUTE } from '../../../test/auth-helpers';
import { createTestDatabase, TEST_DATABASE_URL, type TestDatabase } from '../../../test/db';
import { createUsers, hasAcceptedCurrentPrivacy } from './index';

const IDENTITY = {
  googleSub: 'google-abc',
  email: 'fulano@prefeitura.example.test',
  fullName: 'Fulano de Tal',
};

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    return error instanceof AppError ? error.code : `inesperado: ${String(error)}`;
  }
  return undefined;
}

// Precisa do PostgreSQL do Compose (`npm run db:up`) e de TEST_DATABASE_URL no .env.
describe.skipIf(!TEST_DATABASE_URL)('users service', () => {
  let test: TestDatabase;
  const orm = () => test.db.orm;
  const clock = createClock();
  const service = () => createUsers({ orm: orm(), now: clock.now });

  beforeAll(async () => {
    test = await createTestDatabase();
  }, 30_000);

  afterAll(async () => {
    await test.drop();
  }, 30_000);

  beforeEach(async () => {
    await orm().execute(sql`truncate table users restart identity cascade`);
  });

  describe('upsertFromGoogle', () => {
    it('cria o usuário no primeiro login, com papel "user" e sem aviso de privacidade aceito', async () => {
      const user = await service().upsertFromGoogle(IDENTITY);
      expect(user).toMatchObject({
        email: IDENTITY.email,
        fullName: IDENTITY.fullName,
        role: 'user',
        defaultSector: null,
        privacyAckVersion: null,
      });
      const [row] = await orm().select().from(users).where(eq(users.id, user.id));
      expect(row?.lastLoginAt).toEqual(clock.now());
    });

    it('reconhece o mesmo usuário pelo sub e atualiza o último login', async () => {
      const first = await service().upsertFromGoogle(IDENTITY);
      clock.advance(5 * MINUTE);
      const second = await service().upsertFromGoogle(IDENTITY);

      expect(second.id).toBe(first.id);
      expect(await orm().select().from(users)).toHaveLength(1);
      const [row] = await orm().select().from(users);
      expect(row?.lastLoginAt).toEqual(clock.now());
    });

    it('acompanha uma mudança de nome e de e-mail no Google, pelo sub', async () => {
      const first = await service().upsertFromGoogle(IDENTITY);
      const renamed = await service().upsertFromGoogle({
        ...IDENTITY,
        email: 'fulano.novo@prefeitura.example.test',
        fullName: 'Fulano Novo',
      });
      expect(renamed.id).toBe(first.id);
      expect(renamed).toMatchObject({
        email: 'fulano.novo@prefeitura.example.test',
        fullName: 'Fulano Novo',
      });
    });

    it('não altera o papel de quem já existe', async () => {
      const first = await service().upsertFromGoogle(IDENTITY);
      await orm().update(users).set({ role: 'admin' }).where(eq(users.id, first.id));
      expect((await service().upsertFromGoogle(IDENTITY)).role).toBe('admin');
    });

    it('recusa o mesmo e-mail com outro sub, sem criar nem unir contas', async () => {
      await service().upsertFromGoogle(IDENTITY);
      const code = await codeOf(
        service().upsertFromGoogle({ ...IDENTITY, googleSub: 'google-outro' }),
      );
      expect(code).toBe('ACCOUNT_CONFLICT');
      expect(await orm().select().from(users)).toHaveLength(1);
    });

    it('recusa trocar o e-mail para um que já pertence a outro usuário', async () => {
      await service().upsertFromGoogle(IDENTITY);
      await service().upsertFromGoogle({
        googleSub: 'google-2',
        email: 'ciclana@prefeitura.example.test',
        fullName: 'Ciclana',
      });
      const code = await codeOf(
        service().upsertFromGoogle({ ...IDENTITY, email: 'ciclana@prefeitura.example.test' }),
      );
      expect(code).toBe('ACCOUNT_CONFLICT');
    });

    it('recusa uma conta desativada', async () => {
      const user = await service().upsertFromGoogle(IDENTITY);
      await orm().update(users).set({ disabledAt: clock.now() }).where(eq(users.id, user.id));
      expect(await codeOf(service().upsertFromGoogle(IDENTITY))).toBe('ACCOUNT_DISABLED');
    });

    it('cria uma única conta quando o primeiro login acontece várias vezes ao mesmo tempo', async () => {
      const results = await Promise.all(
        Array.from({ length: 6 }, () => service().upsertFromGoogle(IDENTITY)),
      );
      expect(new Set(results.map((user) => user.id)).size).toBe(1);
      expect(await orm().select().from(users)).toHaveLength(1);
    });
  });

  describe('getActiveById', () => {
    it('devolve usuários ativos e ignora desativados e inexistentes', async () => {
      const active = await insertUser(orm());
      const disabled = await insertUser(orm(), { disabledAt: new Date() });
      expect((await service().getActiveById(active.id))?.id).toBe(active.id);
      expect(await service().getActiveById(disabled.id)).toBeNull();
      expect(await service().getActiveById('00000000-0000-4000-8000-000000000000')).toBeNull();
      // `getById` continua devolvendo o usuário desativado, para uso administrativo.
      expect((await service().getById(disabled.id))?.id).toBe(disabled.id);
    });
  });

  describe('aviso de privacidade', () => {
    it('registra a versão aceita e passa a constar como aceito', async () => {
      const user = await service().upsertFromGoogle(IDENTITY);
      expect(hasAcceptedCurrentPrivacy(user)).toBe(false);

      await service().acceptPrivacy(user.id, PRIVACY_NOTICE_VERSION);

      const updated = await service().getById(user.id);
      expect(updated?.privacyAckVersion).toBe(PRIVACY_NOTICE_VERSION);
      expect(updated && hasAcceptedCurrentPrivacy(updated)).toBe(true);
      const [row] = await orm().select().from(users).where(eq(users.id, user.id));
      expect(row?.privacyAckAt).toEqual(clock.now());
    });

    it('recusa uma versão que não é a atual', async () => {
      const user = await service().upsertFromGoogle(IDENTITY);
      expect(await codeOf(service().acceptPrivacy(user.id, 'versao-antiga'))).toBe(
        'PRIVACY_VERSION_MISMATCH',
      );
      expect(hasAcceptedCurrentPrivacy((await service().getById(user.id))!)).toBe(false);
    });

    it('uma versão antiga aceita deixa de valer quando o aviso muda', () => {
      expect(hasAcceptedCurrentPrivacy({ privacyAckVersion: '2020-01' })).toBe(false);
      expect(hasAcceptedCurrentPrivacy({ privacyAckVersion: null })).toBe(false);
    });
  });

  describe('changeRole', () => {
    const change = (email: string, role: 'user' | 'tecnico' | 'admin') =>
      service().changeRole({ email, role, actorId: null, via: 'cli' });

    it('promove um usuário e registra na auditoria', async () => {
      const user = await insertUser(orm());
      const result = await change(user.email, 'admin');

      expect(result).toEqual({ userId: user.id, previousRole: 'user', role: 'admin' });
      expect((await service().getById(user.id))?.role).toBe('admin');
      const entries = await orm().select().from(auditLog);
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        actorId: null,
        action: 'user.role_changed',
        targetType: 'user',
        targetId: user.id,
        metadata: { from: 'user', to: 'admin', via: 'cli' },
      });
    });

    it('não guarda e-mail nem nome na auditoria', async () => {
      const user = await insertUser(orm(), { email: 'segredo.pessoal@prefeitura.example.test' });
      await change(user.email, 'tecnico');
      const [entry] = await orm().select().from(auditLog);
      expect(JSON.stringify(entry)).not.toContain('segredo.pessoal');
    });

    it('aceita o e-mail com maiúsculas e espaços', async () => {
      const user = await insertUser(orm());
      await change(`  ${user.email.toUpperCase()} `, 'tecnico');
      expect((await service().getById(user.id))?.role).toBe('tecnico');
    });

    it('não registra nada quando o papel já era o pedido', async () => {
      const user = await insertUser(orm(), { role: 'tecnico' });
      const result = await change(user.email, 'tecnico');
      expect(result.previousRole).toBe('tecnico');
      expect(await orm().select().from(auditLog)).toHaveLength(0);
    });

    it('explica que o usuário precisa entrar uma vez antes', async () => {
      const error = await change('ninguem@prefeitura.example.test', 'admin').catch(
        (e: unknown) => e,
      );
      expect(error).toBeInstanceOf(AppError);
      expect(error).toMatchObject({ code: 'USER_NOT_FOUND', statusCode: 404 });
      expect((error as Error).message).toContain('entrar ao menos uma vez');
    });

    it('não deixa rebaixar o último administrador', async () => {
      const admin = await insertUser(orm(), { role: 'admin' });
      expect(await codeOf(change(admin.email, 'user'))).toBe('LAST_ADMIN');
      expect((await service().getById(admin.id))?.role).toBe('admin');
      expect(await orm().select().from(auditLog)).toHaveLength(0);
    });

    it('não conta administradores desativados como substitutos', async () => {
      const admin = await insertUser(orm(), { role: 'admin' });
      await insertUser(orm(), { role: 'admin', disabledAt: new Date() });
      expect(await codeOf(change(admin.email, 'user'))).toBe('LAST_ADMIN');
    });

    it('permite rebaixar um administrador quando existe outro ativo', async () => {
      const first = await insertUser(orm(), { role: 'admin' });
      await insertUser(orm(), { role: 'admin' });
      await change(first.email, 'user');
      expect((await service().getById(first.id))?.role).toBe('user');
    });

    it('nunca deixa o sistema sem administrador, mesmo com dois rebaixamentos simultâneos', async () => {
      const a = await insertUser(orm(), { role: 'admin' });
      const b = await insertUser(orm(), { role: 'admin' });

      const results = await Promise.allSettled([change(a.email, 'user'), change(b.email, 'user')]);

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.filter((r) => r.status === 'rejected');
      expect(rejected).toHaveLength(1);
      expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({ code: 'LAST_ADMIN' });
      const admins = await orm().select().from(users).where(eq(users.role, 'admin'));
      expect(admins).toHaveLength(1);
    });

    it('desfaz tudo se a auditoria falhar: o papel e o registro andam juntos', async () => {
      const user = await insertUser(orm());
      // Uma ação inexistente não falha; força o erro com um ator que não existe (chave estrangeira).
      const result = service().changeRole({
        email: user.email,
        role: 'admin',
        actorId: '00000000-0000-4000-8000-000000000000',
        via: 'admin',
      });
      await expect(result).rejects.toThrow();
      expect((await service().getById(user.id))?.role).toBe('user');
    });
  });
});
