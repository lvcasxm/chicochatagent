import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PRIVACY_NOTICE_VERSION, USER_ROLES, type UserRole } from '@chicochat/shared';
import { createApp } from '../app';
import { users } from '../db/schema';
import { createSessionService } from '../modules/auth/sessions';
import { createUsers } from '../modules/users';
import { createClock, insertUser, HOUR } from '../../test/auth-helpers';
import { createTestDatabase, TEST_DATABASE_URL, type TestDatabase } from '../../test/db';
import { captureLogger, testConfig } from '../../test/helpers';

const ORIGIN = testConfig.appOrigin;

/** Rotas reais que podem ser abertas a qualquer pessoa. Qualquer outra precisa de login. */
const EXPECTED_PUBLIC_ROUTES = [
  'GET /api/auth/google',
  'GET /api/auth/google/callback',
  'GET /api/health',
];

// Precisa do PostgreSQL do Compose (`npm run db:up`) e de TEST_DATABASE_URL no .env.
describe.skipIf(!TEST_DATABASE_URL)('controle de acesso', () => {
  let test: TestDatabase;
  let app: FastifyInstance;
  const orm = () => test.db.orm;
  const clock = createClock();

  beforeAll(async () => {
    test = await createTestDatabase();
    const { logger } = captureLogger();
    app = await createApp({ config: testConfig, logger, db: test.db, oidc: null, now: clock.now });

    // Rotas de apoio que cobrem cada tipo de configuração de acesso.
    app.get('/t/public', { config: { public: true } }, () => ({ ok: true }));
    app.get('/t/default', () => ({ ok: true }));
    app.get('/t/staff', { config: { roles: ['tecnico', 'admin'] } }, () => ({ ok: true }));
    app.get('/t/admin', { config: { roles: ['admin'] } }, () => ({ ok: true }));
    app.get('/t/privacy', { config: { requiresPrivacyAck: true } }, () => ({ ok: true }));
    app.get('/t/admin-privacy', { config: { roles: ['admin'], requiresPrivacyAck: true } }, () => ({
      ok: true,
    }));
    app.post('/t/write', () => ({ ok: true }));
    app.post('/t/public-write', { config: { public: true } }, () => ({ ok: true }));
    await app.ready();
  }, 30_000);

  afterAll(async () => {
    await app.close();
    await test.drop();
  }, 30_000);

  beforeEach(async () => {
    clock.set(new Date('2026-03-02T12:00:00.000Z'));
    await orm().execute(sql`truncate table users restart identity cascade`);
  });

  const usersService = () => createUsers({ orm: orm(), now: clock.now });
  const sessionService = () =>
    createSessionService({ orm: orm(), users: usersService(), now: clock.now });

  /** Cria um usuário com o papel pedido e devolve o cabeçalho de cookie da sessão dele. */
  async function cookieFor(role: UserRole, options: { privacyAccepted?: boolean } = {}) {
    const accepted = options.privacyAccepted ?? true;
    const user = await insertUser(orm(), {
      role,
      ...(accepted ? { privacyAckAt: clock.now(), privacyAckVersion: PRIVACY_NOTICE_VERSION } : {}),
    });
    const { token } = await sessionService().create(user.id);
    return { user, cookie: `chico_session=${token}` };
  }

  async function status(
    url: string,
    actor: UserRole | 'anonymous',
    options: { method?: 'GET' | 'POST'; origin?: string | null; privacyAccepted?: boolean } = {},
  ) {
    const headers: Record<string, string> = {};
    if (actor !== 'anonymous') {
      const { cookie } = await cookieFor(actor, { privacyAccepted: options.privacyAccepted });
      headers.cookie = cookie;
    }
    const method = options.method ?? 'GET';
    if (method === 'POST' && options.origin !== null) headers.origin = options.origin ?? ORIGIN;
    const response = await app.inject({ method, url, headers });
    return { status: response.statusCode, body: response.json<{ error?: { code: string } }>() };
  }

  describe('matriz por papel', () => {
    // Para cada rota: o resultado esperado para anônimo, user, tecnico e admin.
    const MATRIX: Array<[string, Record<UserRole | 'anonymous', number>]> = [
      ['/t/public', { anonymous: 200, user: 200, tecnico: 200, admin: 200 }],
      ['/t/default', { anonymous: 401, user: 200, tecnico: 200, admin: 200 }],
      ['/t/staff', { anonymous: 401, user: 403, tecnico: 200, admin: 200 }],
      ['/t/admin', { anonymous: 401, user: 403, tecnico: 403, admin: 200 }],
    ];

    for (const [url, expected] of MATRIX) {
      for (const actor of ['anonymous', ...USER_ROLES] as const) {
        it(`${url} para ${actor}: ${expected[actor]}`, async () => {
          expect((await status(url, actor)).status).toBe(expected[actor]);
        });
      }
    }

    it('um papel sem permissão recebe o erro padrão, sem detalhes', async () => {
      const response = await status('/t/admin', 'user');
      expect(response.body).toEqual({
        error: { code: 'FORBIDDEN', message: 'Você não tem permissão para isso.' },
      });
    });

    it('o anônimo recebe o erro padrão de não autenticado', async () => {
      const response = await status('/t/default', 'anonymous');
      expect(response.body.error?.code).toBe('UNAUTHENTICATED');
    });
  });

  describe('aviso de privacidade', () => {
    it('quem não aceitou é barrado nas rotas que exigem o aceite', async () => {
      const response = await status('/t/privacy', 'user', { privacyAccepted: false });
      expect(response.status).toBe(403);
      expect(response.body.error?.code).toBe('PRIVACY_NOT_ACCEPTED');
    });

    it('quem aceitou a versão atual passa', async () => {
      expect((await status('/t/privacy', 'user', { privacyAccepted: true })).status).toBe(200);
    });

    it('uma versão antiga aceita não vale', async () => {
      const user = await insertUser(orm(), {
        privacyAckAt: clock.now(),
        privacyAckVersion: '2020-01',
      });
      const { token } = await sessionService().create(user.id);
      const response = await app.inject({
        url: '/t/privacy',
        headers: { cookie: `chico_session=${token}` },
      });
      expect(response.statusCode).toBe(403);
    });

    it('rotas sem a exigência não dependem do aceite', async () => {
      expect((await status('/t/default', 'user', { privacyAccepted: false })).status).toBe(200);
    });

    it('o papel é conferido antes do aceite', async () => {
      const response = await status('/t/admin-privacy', 'user', { privacyAccepted: false });
      expect(response.body.error?.code).toBe('FORBIDDEN');
    });

    it('anônimo recebe 401 antes de qualquer outra verificação', async () => {
      expect((await status('/t/privacy', 'anonymous')).status).toBe(401);
    });
  });

  describe('sessões inválidas', () => {
    it('cookie com lixo, vazio ou com identificador desconhecido: 401', async () => {
      for (const cookie of [
        'chico_session=lixo',
        'chico_session=',
        `chico_session=${'a'.repeat(43)}`,
        `chico_session=${'a'.repeat(44)}`,
        'outro_cookie=valor',
      ]) {
        const response = await app.inject({ url: '/t/default', headers: { cookie } });
        expect(response.statusCode, cookie).toBe(401);
      }
    });

    it('sessão expirada por inatividade: 401', async () => {
      const { cookie } = await cookieFor('user');
      clock.advance(8 * HOUR);
      expect((await app.inject({ url: '/t/default', headers: { cookie } })).statusCode).toBe(401);
    });

    it('sessão de usuário desativado: 401', async () => {
      const { user, cookie } = await cookieFor('admin');
      await orm()
        .update(users)
        .set({ disabledAt: clock.now() })
        .where(sql`${users.id} = ${user.id}`);
      expect((await app.inject({ url: '/t/admin', headers: { cookie } })).statusCode).toBe(401);
    });

    it('rebaixar o papel vale na requisição seguinte, sem esperar a sessão acabar', async () => {
      const { user, cookie } = await cookieFor('admin');
      expect((await app.inject({ url: '/t/admin', headers: { cookie } })).statusCode).toBe(200);

      await usersService()
        .changeRole({
          email: user.email,
          role: 'user',
          actorId: null,
          via: 'admin',
        })
        .catch(() => undefined);
      // É o único administrador: o sistema recusa. Cria outro e tenta de novo.
      await insertUser(orm(), { role: 'admin' });
      await usersService().changeRole({
        email: user.email,
        role: 'user',
        actorId: null,
        via: 'admin',
      });

      expect((await app.inject({ url: '/t/admin', headers: { cookie } })).statusCode).toBe(403);
    });
  });

  describe('rotas inexistentes', () => {
    it('respondem 404 para qualquer pessoa, logada ou não', async () => {
      expect((await status('/nao-existe', 'anonymous')).status).toBe(404);
      expect((await status('/nao-existe', 'user')).status).toBe(404);
      expect((await status('/api/nao-existe', 'admin')).status).toBe(404);
    });
  });

  describe('proteção contra CSRF', () => {
    const wrongOrigins: Array<string | null> = [
      null,
      'null',
      'https://evil.test',
      `${ORIGIN}.evil.test`,
      'http://127.0.0.1:9999',
      'https://127.0.0.1:5173',
      `${ORIGIN}/`,
    ];

    for (const origin of wrongOrigins) {
      it(`recusa escrita com Origin ${origin === null ? 'ausente' : `"${origin}"`}, mesmo logado`, async () => {
        const response = await status('/t/write', 'admin', { method: 'POST', origin });
        expect(response.status).toBe(403);
        expect(response.body.error?.code).toBe('INVALID_ORIGIN');
      });
    }

    it('aceita escrita com o Origin do sistema', async () => {
      expect((await status('/t/write', 'user', { method: 'POST' })).status).toBe(200);
    });

    it('a verificação vem antes do login: escrita anônima com Origin errado recebe 403', async () => {
      const response = await status('/t/write', 'anonymous', { method: 'POST', origin: null });
      expect(response.status).toBe(403);
    });

    it('com o Origin certo, a escrita anônima em rota protegida recebe 401', async () => {
      expect((await status('/t/write', 'anonymous', { method: 'POST' })).status).toBe(401);
    });

    it('vale também para rotas públicas de escrita', async () => {
      const wrong = await status('/t/public-write', 'anonymous', { method: 'POST', origin: null });
      expect(wrong.status).toBe(403);
      expect((await status('/t/public-write', 'anonymous', { method: 'POST' })).status).toBe(200);
    });

    it('leituras não exigem Origin', async () => {
      const { cookie } = await cookieFor('user');
      expect((await app.inject({ url: '/t/default', headers: { cookie } })).statusCode).toBe(200);
    });

    it('não confunde métodos: PUT, PATCH e DELETE também exigem o Origin', async () => {
      for (const method of ['PUT', 'PATCH', 'DELETE'] as const) {
        const response = await app.inject({ method, url: '/t/write' });
        expect(response.statusCode, method).toBe(403);
      }
    });
  });

  describe('rotas reais da aplicação', () => {
    const realRoutes = () => app.routeCatalog.filter((route) => route.url.startsWith('/api/'));

    it('só as rotas esperadas são públicas', () => {
      const publicRoutes = realRoutes()
        .filter((route) => route.public)
        .map((route) => `${route.method} ${route.url}`)
        .sort();
      expect(publicRoutes).toEqual(EXPECTED_PUBLIC_ROUTES);
    });

    it('o catálogo enxerga as rotas protegidas conhecidas', () => {
      const protectedRoutes = realRoutes()
        .filter((route) => !route.public)
        .map((route) => `${route.method} ${route.url}`)
        .sort();
      expect(protectedRoutes).toEqual([
        'DELETE /api/admin/categories/:id',
        'DELETE /api/conversations/:id',
        'GET /api/admin/audit',
        'GET /api/admin/categories',
        'GET /api/admin/conversations',
        'GET /api/admin/conversations/:id',
        'GET /api/admin/export/:type',
        'GET /api/admin/instructions',
        'GET /api/admin/instructions/versions/:version',
        'GET /api/admin/metrics',
        'GET /api/admin/prompt',
        'GET /api/admin/users',
        'GET /api/bootstrap',
        'GET /api/conversations',
        'GET /api/conversations/:id',
        'GET /api/me',
        'GET /api/tickets/mine',
        'GET /api/transcripts/:token',
        'PATCH /api/admin/users/:id/role',
        'POST /api/admin/categories',
        'POST /api/admin/insights',
        'POST /api/admin/instructions/:version/restore',
        'POST /api/admin/instructions/draft/publish',
        'POST /api/admin/instructions/draft/rehearse',
        'POST /api/admin/instructions/propose',
        'POST /api/auth/logout',
        'POST /api/conversations',
        'POST /api/conversations/:id/feedback',
        'POST /api/conversations/:id/messages',
        'POST /api/conversations/:id/ticket-check',
        'POST /api/conversations/:id/tickets',
        'POST /api/me/privacy-ack',
        'PUT /api/admin/categories/:id',
        'PUT /api/admin/instructions/draft',
      ]);
    });

    it('toda rota não pública recusa anônimos com 401', async () => {
      const protectedRoutes = realRoutes().filter((route) => !route.public);
      expect(protectedRoutes.length).toBeGreaterThan(0);
      for (const route of protectedRoutes) {
        const method = route.method as 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
        const response = await app.inject({
          method,
          url: route.url,
          headers: method === 'GET' ? {} : { origin: ORIGIN },
        });
        expect(response.statusCode, `${route.method} ${route.url}`).toBe(401);
      }
    });

    it('toda rota não pública aceita um usuário logado (a resposta pode ser de validação)', async () => {
      for (const route of realRoutes().filter((r) => !r.public && !r.roles)) {
        const { cookie } = await cookieFor('user');
        const method = route.method === 'POST' ? 'POST' : 'GET';
        const response = await app.inject({
          method,
          url: route.url,
          headers: method === 'POST' ? { cookie, origin: ORIGIN } : { cookie },
        });
        expect([401, 403], `${route.method} ${route.url}`).not.toContain(response.statusCode);
      }
    });

    it('toda rota de administração é só do admin: user e tecnico recebem 403', async () => {
      const adminRoutes = realRoutes().filter((r) => r.url.startsWith('/api/admin/'));
      expect(adminRoutes.length).toBeGreaterThan(10);
      for (const route of adminRoutes) {
        expect(route.roles, `${route.method} ${route.url}`).toEqual(['admin']);
        const url = route.url
          .replace(':id', '3f9a1c52-8d4e-4b7a-9c1e-2a6b5d8e0f13')
          .replace(':type', 'conversations')
          .replace(':version', '1');
        for (const role of ['user', 'tecnico'] as const) {
          const { cookie } = await cookieFor(role);
          const method = route.method as 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
          const response = await app.inject({
            method,
            url,
            headers: method === 'GET' ? { cookie } : { cookie, origin: ORIGIN },
          });
          expect(response.statusCode, `${role}: ${route.method} ${route.url}`).toBe(403);
        }
      }
    });

    it('as rotas públicas respondem sem login', async () => {
      for (const route of realRoutes().filter((r) => r.public)) {
        const response = await app.inject({ method: 'GET', url: route.url });
        expect([401, 403], `${route.method} ${route.url}`).not.toContain(response.statusCode);
      }
    });
  });

  describe('perfil e aceite do aviso de privacidade', () => {
    it('GET /api/me devolve o perfil sem campos internos', async () => {
      const { user, cookie } = await cookieFor('tecnico', { privacyAccepted: false });
      const response = await app.inject({ url: '/api/me', headers: { cookie } });

      expect(response.json()).toEqual({
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: 'tecnico',
        defaultSector: null,
        privacyAccepted: false,
      });
      // Nada de googleSub, datas internas ou identificadores de sessão.
      expect(Object.keys(response.json<object>()).sort()).toEqual(
        ['defaultSector', 'email', 'fullName', 'id', 'privacyAccepted', 'role'].sort(),
      );
    });

    it('registra o aceite da versão atual e passa a constar como aceito', async () => {
      const { cookie } = await cookieFor('user', { privacyAccepted: false });
      const headers = { cookie, origin: ORIGIN };

      const ack = await app.inject({
        method: 'POST',
        url: '/api/me/privacy-ack',
        headers,
        payload: { version: PRIVACY_NOTICE_VERSION },
      });
      expect(ack.statusCode).toBe(204);

      const me = await app.inject({ url: '/api/me', headers: { cookie } });
      expect(me.json()).toMatchObject({ privacyAccepted: true });
    });

    it('recusa uma versão que não é a atual', async () => {
      const { cookie } = await cookieFor('user', { privacyAccepted: false });
      const response = await app.inject({
        method: 'POST',
        url: '/api/me/privacy-ack',
        headers: { cookie, origin: ORIGIN },
        payload: { version: 'versao-antiga' },
      });
      expect(response.statusCode).toBe(422);
      expect(response.json()).toMatchObject({ error: { code: 'PRIVACY_VERSION_MISMATCH' } });
    });

    it('recusa corpo ausente, vazio ou com tipos errados, sem detalhar o erro', async () => {
      const { cookie } = await cookieFor('user', { privacyAccepted: false });
      for (const payload of [
        undefined,
        {},
        { version: 5 },
        { version: '' },
        { version: 'x'.repeat(41) },
      ]) {
        const response = await app.inject({
          method: 'POST',
          url: '/api/me/privacy-ack',
          headers: { cookie, origin: ORIGIN },
          ...(payload === undefined ? {} : { payload }),
        });
        expect(response.statusCode, JSON.stringify(payload)).toBe(422);
        expect(response.json()).toEqual({
          error: { code: 'INVALID_INPUT', message: 'Os dados enviados são inválidos.' },
        });
      }
    });

    it('o aceite vale só para o próprio usuário', async () => {
      const first = await cookieFor('user', { privacyAccepted: false });
      const second = await cookieFor('user', { privacyAccepted: false });
      await app.inject({
        method: 'POST',
        url: '/api/me/privacy-ack',
        headers: { cookie: first.cookie, origin: ORIGIN },
        payload: { version: PRIVACY_NOTICE_VERSION },
      });
      const other = await app.inject({ url: '/api/me', headers: { cookie: second.cookie } });
      expect(other.json()).toMatchObject({ privacyAccepted: false });
    });
  });
});
