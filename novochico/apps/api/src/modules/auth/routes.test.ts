import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../app';
import type { Config } from '../../config';
import { sessions, users } from '../../db/schema';
import { createGoogleOidcClient, type GoogleOidcClient } from '../../integrations/google/oidc';
import { createClock, insertUser, MINUTE } from '../../../test/auth-helpers';
import { createTestDatabase, TEST_DATABASE_URL, type TestDatabase } from '../../../test/db';
import {
  startFakeOidc,
  type FakeIdentity,
  type FakeOidc,
  type Tamper,
} from '../../../test/fake-oidc';
import { captureLogger, testConfig } from '../../../test/helpers';

const ORIGIN = 'http://127.0.0.1:5173';

const IDENTITY: FakeIdentity = {
  sub: 'google-123',
  email: 'fulano@prefeitura.example.test',
  email_verified: true,
  hd: 'prefeitura.example.test',
  name: 'Fulano de Tal',
};

/** Cookies enviados de volta como o navegador faria: o valor volta codificado. */
function cookieHeader(pairs: Record<string, string>): string {
  return Object.entries(pairs)
    .map(([name, value]) => `${name}=${encodeURIComponent(value)}`)
    .join('; ');
}

// Precisa do PostgreSQL do Compose (`npm run db:up`) e de TEST_DATABASE_URL no .env.
describe.skipIf(!TEST_DATABASE_URL)('rotas de autenticação', () => {
  let test: TestDatabase;
  let fake: FakeOidc;
  const orm = () => test.db.orm;
  const clock = createClock();
  const apps: FastifyInstance[] = [];

  beforeAll(async () => {
    fake = await startFakeOidc();
    test = await createTestDatabase();
  }, 30_000);

  afterAll(async () => {
    await Promise.all(apps.map((app) => app.close()));
    await fake.close();
    await test.drop();
  }, 30_000);

  beforeEach(async () => {
    clock.set(new Date('2026-03-02T12:00:00.000Z'));
    await orm().execute(sql`truncate table users restart identity cascade`);
  });

  function realOidc(): GoogleOidcClient {
    return createGoogleOidcClient({
      clientId: fake.clientId,
      clientSecret: fake.clientSecret,
      hostedDomain: 'prefeitura.example.test',
      issuer: fake.issuer,
      allowInsecure: true,
    });
  }

  async function makeApp(
    options: { config?: Partial<Config>; oidc?: GoogleOidcClient | null } = {},
  ) {
    const config: Config = {
      ...testConfig,
      appOrigin: ORIGIN,
      google: {
        clientId: fake.clientId,
        clientSecret: fake.clientSecret,
        hostedDomain: 'prefeitura.example.test',
      },
      ...options.config,
    };
    const { logger, output } = captureLogger();
    const app = await buildApp({
      config,
      logger,
      db: test.db,
      oidc: options.oidc === undefined ? realOidc() : options.oidc,
      now: clock.now,
    });
    apps.push(app);
    return { app, output, config };
  }

  /**
   * Percorre o login como o navegador: início, ida ao Google, aprovação e volta, devolvendo
   * as duas respostas do servidor.
   */
  async function browserLogin(
    app: FastifyInstance,
    identity: FakeIdentity,
    options: {
      redirect?: string;
      tamper?: Tamper;
      mutateCallback?: (callback: URL) => void;
      loginCookie?: (original: string | undefined) => string | undefined;
    } = {},
  ) {
    const query = options.redirect ? `?redirect=${encodeURIComponent(options.redirect)}` : '';
    const start = await app.inject(`/api/auth/google${query}`);
    expect(start.statusCode).toBe(302);

    const authorizationUrl = new URL(start.headers.location as string);
    const original = start.cookies.find((cookie) => cookie.name === 'chico_oidc')?.value;
    const callback = await fake.approve(authorizationUrl, identity, options.tamper);
    options.mutateCallback?.(callback);

    const loginCookie = options.loginCookie ? options.loginCookie(original) : original;
    const result = await app.inject({
      url: `${callback.pathname}${callback.search}`,
      headers: loginCookie ? { cookie: cookieHeader({ chico_oidc: loginCookie }) } : {},
    });
    return { start, result, original };
  }

  const sessionCookieOf = (response: { cookies: Array<{ name: string; value: string }> }) =>
    response.cookies.find((cookie) => cookie.name === 'chico_session');

  describe('login completo', () => {
    it('cria o usuário, abre a sessão e leva ao destino pedido', async () => {
      const { app } = await makeApp();
      const { result } = await browserLogin(app, IDENTITY, { redirect: '/c/123?aba=2' });

      expect(result.statusCode).toBe(302);
      expect(result.headers.location).toBe('/c/123?aba=2');

      const [user] = await orm().select().from(users);
      expect(user).toMatchObject({
        email: 'fulano@prefeitura.example.test',
        fullName: 'Fulano de Tal',
        googleSub: 'google-123',
        role: 'user',
      });

      const session = sessionCookieOf(result);
      expect(session?.value).toMatch(/^[A-Za-z0-9_-]{43}$/);
      const [row] = await orm().select().from(sessions);
      expect(row?.userId).toBe(user?.id);
      expect(row?.tokenHash).not.toBe(session?.value);
    });

    it('o cookie de sessão é HttpOnly, SameSite=Lax, vale para o site todo e dura 7 dias', async () => {
      const { app } = await makeApp();
      const { result } = await browserLogin(app, IDENTITY);

      const cookie = result.cookies.find((c) => c.name === 'chico_session');
      expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/' });
      // Sem HTTPS (ambiente local), o cookie não pode exigir Secure, ou o navegador o recusaria.
      expect(cookie?.secure).toBeFalsy();
      expect(cookie?.domain).toBeUndefined();
      expect(cookie?.expires?.getTime()).toBe(clock.now().getTime() + 7 * 24 * 60 * MINUTE);
    });

    it('a sessão criada funciona nas rotas protegidas', async () => {
      const { app } = await makeApp();
      const { result } = await browserLogin(app, IDENTITY);
      const session = sessionCookieOf(result)!;

      const me = await app.inject({
        url: '/api/me',
        headers: { cookie: cookieHeader({ chico_session: session.value }) },
      });

      expect(me.statusCode).toBe(200);
      expect(me.json()).toMatchObject({
        email: 'fulano@prefeitura.example.test',
        fullName: 'Fulano de Tal',
        role: 'user',
        privacyAccepted: false,
      });
    });

    it('um segundo login reaproveita o usuário e cria uma sessão nova', async () => {
      const { app } = await makeApp();
      const first = await browserLogin(app, IDENTITY);
      clock.advance(10 * MINUTE);
      const second = await browserLogin(app, IDENTITY);

      expect(await orm().select().from(users)).toHaveLength(1);
      expect(await orm().select().from(sessions)).toHaveLength(2);
      expect(sessionCookieOf(second.result)?.value).not.toBe(sessionCookieOf(first.result)?.value);
    });

    it('a ida ao Google leva os parâmetros de segurança e o cookie temporário assinado', async () => {
      const { app } = await makeApp();
      const start = await app.inject('/api/auth/google');

      const location = new URL(start.headers.location as string);
      expect(location.origin).toBe(fake.issuer.origin);
      expect(location.searchParams.get('redirect_uri')).toBe(`${ORIGIN}/api/auth/google/callback`);
      expect(location.searchParams.get('code_challenge_method')).toBe('S256');
      expect(location.searchParams.get('hd')).toBe('prefeitura.example.test');

      const cookie = start.cookies.find((c) => c.name === 'chico_oidc');
      expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/api/auth' });
      expect(cookie?.maxAge).toBe(600);
      // O valor é assinado: termina com ".<assinatura>".
      expect(cookie?.value).toMatch(/\.[A-Za-z0-9+/_-]{20,}$/);
    });

    it('limpa o cookie temporário na volta, qualquer que seja o resultado', async () => {
      const { app } = await makeApp();
      const { result } = await browserLogin(app, IDENTITY);
      const cleared = result.cookies.find((c) => c.name === 'chico_oidc');
      expect(cleared?.value).toBe('');
      expect(cleared?.path).toBe('/api/auth');
    });
  });

  describe('contas recusadas pela política', () => {
    async function expectRefused(identity: FakeIdentity, code: string) {
      const { app } = await makeApp();
      const { result } = await browserLogin(app, identity);
      expect(result.statusCode).toBe(302);
      expect(result.headers.location).toBe(`/login?error=${code}`);
      expect(sessionCookieOf(result)).toBeUndefined();
      expect(await orm().select().from(users)).toHaveLength(0);
      expect(await orm().select().from(sessions)).toHaveLength(0);
    }

    it('de outro domínio', () =>
      expectRefused({ ...IDENTITY, email: 'a@gmail.com', hd: undefined }, 'domain'));

    it('pessoal, com e-mail do domínio mas sem Workspace (hd)', () =>
      expectRefused({ ...IDENTITY, hd: undefined }, 'domain'));

    it('com Workspace de outro domínio', () =>
      expectRefused({ ...IDENTITY, hd: 'outra-prefeitura.example.test' }, 'domain'));

    it('com e-mail não verificado', () =>
      expectRefused({ ...IDENTITY, email_verified: false }, 'unverified'));

    it('com e-mail_verified como texto, não booleano', () =>
      expectRefused({ ...IDENTITY, email_verified: 'true' }, 'unverified'));

    it('desativadas', async () => {
      await insertUser(orm(), {
        googleSub: IDENTITY.sub,
        email: IDENTITY.email,
        disabledAt: new Date(),
      });
      const { app } = await makeApp();
      const { result } = await browserLogin(app, IDENTITY);
      expect(result.headers.location).toBe('/login?error=disabled');
      expect(sessionCookieOf(result)).toBeUndefined();
      expect(await orm().select().from(sessions)).toHaveLength(0);
    });

    it('com o e-mail de outro usuário e um sub diferente', async () => {
      await insertUser(orm(), { email: IDENTITY.email, googleSub: 'google-de-outra-pessoa' });
      const { app } = await makeApp();
      const { result } = await browserLogin(app, IDENTITY);
      expect(result.headers.location).toBe('/login?error=failed');
      expect(await orm().select().from(sessions)).toHaveLength(0);
    });

    it('sem registrar o e-mail recusado no log', async () => {
      const { app, output } = await makeApp();
      await browserLogin(app, { ...IDENTITY, email: 'sigiloso@gmail.com', hd: undefined });
      expect(output()).toContain('Login recusado');
      expect(output()).not.toContain('sigiloso');
    });
  });

  describe('ataques e falhas no meio do caminho', () => {
    async function expectFailure(
      options: Parameters<typeof browserLogin>[2],
      code: string,
      identity = IDENTITY,
    ) {
      const { app } = await makeApp();
      const { result } = await browserLogin(app, identity, options);
      expect(result.headers.location).toBe(`/login?error=${code}`);
      expect(sessionCookieOf(result)).toBeUndefined();
      expect(await orm().select().from(sessions)).toHaveLength(0);
      expect(await orm().select().from(users)).toHaveLength(0);
    }

    it('state diferente do enviado (possível login forjado)', () =>
      expectFailure({ tamper: { state: 'state-forjado' } }, 'failed'));

    it('nonce diferente do enviado (repetição de um token antigo)', () =>
      expectFailure({ tamper: { nonce: 'nonce-de-outro-login' } }, 'failed'));

    it('id_token para outro cliente', () =>
      expectFailure({ tamper: { audience: 'outro-cliente' } }, 'failed'));

    it('id_token vencido', () => expectFailure({ tamper: { expiresInSeconds: -3600 } }, 'failed'));

    it('id_token assinado por chave desconhecida', () =>
      expectFailure({ tamper: { signWithUnknownKey: true } }, 'failed'));

    it('volta sem o cookie temporário', () =>
      expectFailure({ loginCookie: () => undefined }, 'expired'));

    it('cookie temporário adulterado, sem passar pela assinatura', async () => {
      await expectFailure(
        {
          loginCookie: (original) =>
            original?.replace(
              /^\{[^}]*\}/,
              '{"state":"x","nonce":"y","codeVerifier":"z","redirectTo":"https://evil.test","expiresAt":9999999999999}',
            ),
        },
        'expired',
      );
    });

    it('cookie temporário com assinatura trocada', () =>
      expectFailure(
        { loginCookie: (original) => original?.replace(/\.[^.]+$/, '.assinatura-falsa') },
        'expired',
      ));

    it('cookie temporário de outra instalação, assinado com outro segredo', async () => {
      const other = await makeApp({
        config: { sessionSecret: 'um-segredo-bem-diferente-com-mais-de-32-caracteres' },
      });
      const stolen = await other.app.inject('/api/auth/google');
      const foreign = stolen.cookies.find((c) => c.name === 'chico_oidc')?.value;

      await expectFailure({ loginCookie: () => foreign }, 'expired');
    });

    it('o usuário desiste no Google', async () => {
      const { app } = await makeApp();
      const start = await app.inject('/api/auth/google');
      const cookie = start.cookies.find((c) => c.name === 'chico_oidc')!;

      const result = await app.inject({
        url: '/api/auth/google/callback?error=access_denied',
        headers: { cookie: cookieHeader({ chico_oidc: cookie.value }) },
      });

      expect(result.headers.location).toBe('/login?error=cancelled');
      expect(await orm().select().from(sessions)).toHaveLength(0);
    });

    it('o login demora mais de 10 minutos', async () => {
      const { app } = await makeApp();
      const start = await app.inject('/api/auth/google');
      const authorizationUrl = new URL(start.headers.location as string);
      const cookie = start.cookies.find((c) => c.name === 'chico_oidc')!;
      const callback = await fake.approve(authorizationUrl, IDENTITY);

      clock.advance(11 * MINUTE);
      const result = await app.inject({
        url: `${callback.pathname}${callback.search}`,
        headers: { cookie: cookieHeader({ chico_oidc: cookie.value }) },
      });

      expect(result.headers.location).toBe('/login?error=expired');
      expect(await orm().select().from(sessions)).toHaveLength(0);
    });

    it('a volta sem código de autorização', async () => {
      const { app } = await makeApp();
      const start = await app.inject('/api/auth/google');
      const cookie = start.cookies.find((c) => c.name === 'chico_oidc')!;

      const result = await app.inject({
        url: '/api/auth/google/callback',
        headers: { cookie: cookieHeader({ chico_oidc: cookie.value }) },
      });

      expect(result.headers.location).toBe('/login?error=failed');
    });

    it('reutilizar a mesma volta do Google uma segunda vez', async () => {
      const { app } = await makeApp();
      const start = await app.inject('/api/auth/google');
      const authorizationUrl = new URL(start.headers.location as string);
      const cookie = start.cookies.find((c) => c.name === 'chico_oidc')!;
      const callback = await fake.approve(authorizationUrl, IDENTITY);
      const request = {
        url: `${callback.pathname}${callback.search}`,
        headers: { cookie: cookieHeader({ chico_oidc: cookie.value }) },
      };

      const first = await app.inject(request);
      const replay = await app.inject(request);

      expect(first.headers.location).toBe('/');
      expect(replay.headers.location).toBe('/login?error=failed');
      expect(await orm().select().from(sessions)).toHaveLength(1);
    });

    it('o Google recusa o código na troca por token', async () => {
      const { app } = await makeApp();
      const start = await app.inject('/api/auth/google');
      const authorizationUrl = new URL(start.headers.location as string);
      const cookie = start.cookies.find((c) => c.name === 'chico_oidc')!;
      const callback = await fake.approve(authorizationUrl, IDENTITY);

      fake.rejectNextTokenRequest();
      const result = await app.inject({
        url: `${callback.pathname}${callback.search}`,
        headers: { cookie: cookieHeader({ chico_oidc: cookie.value }) },
      });

      expect(result.headers.location).toBe('/login?error=failed');
    });
  });

  describe('redirecionamento depois do login', () => {
    async function destinationFor(redirect: string) {
      const { app } = await makeApp();
      const { result } = await browserLogin(app, IDENTITY, { redirect });
      return result.headers.location;
    }

    it('ignora endereços de outros sites (redirecionamento aberto)', async () => {
      for (const redirect of [
        'https://evil.test',
        '//evil.test',
        '/\\evil.test',
        'javascript:alert(1)',
      ]) {
        expect(await destinationFor(redirect), redirect).toBe('/');
      }
    });

    it('não volta para a tela de login nem para a API', async () => {
      expect(await destinationFor('/login')).toBe('/');
      expect(await destinationFor('/api/me')).toBe('/');
    });

    it('sem destino, vai para a página inicial', async () => {
      const { app } = await makeApp();
      const { result } = await browserLogin(app, IDENTITY);
      expect(result.headers.location).toBe('/');
    });
  });

  describe('login indisponível', () => {
    it('sem credenciais do Google, o início do login leva à tela de login com o motivo', async () => {
      const { app } = await makeApp({ oidc: null, config: { google: null } });
      const start = await app.inject('/api/auth/google');
      expect(start.statusCode).toBe(302);
      expect(start.headers.location).toBe('/login?error=unavailable');
      expect(start.cookies).toHaveLength(0);
    });

    it('com o Google fora do ar, a API continua respondendo e avisa o usuário', async () => {
      const offline = createGoogleOidcClient({
        clientId: 'x',
        clientSecret: 'y',
        issuer: new URL('http://127.0.0.1:1'),
        allowInsecure: true,
      });
      const { app } = await makeApp({ oidc: offline });

      const start = await app.inject('/api/auth/google');
      expect(start.headers.location).toBe('/login?error=unavailable');
      expect((await app.inject('/api/health')).statusCode).toBe(200);
    }, 30_000);
  });

  describe('logout', () => {
    async function loggedIn() {
      const ctx = await makeApp();
      const { result } = await browserLogin(ctx.app, IDENTITY);
      const session = sessionCookieOf(result)!;
      return {
        ...ctx,
        session,
        headers: { cookie: cookieHeader({ chico_session: session.value }) },
      };
    }

    it('revoga a sessão: o cookie antigo deixa de valer', async () => {
      const { app, headers } = await loggedIn();

      const logout = await app.inject({
        method: 'POST',
        url: '/api/auth/logout',
        headers: { ...headers, origin: ORIGIN },
      });

      expect(logout.statusCode).toBe(204);
      const cleared = logout.cookies.find((c) => c.name === 'chico_session');
      expect(cleared?.value).toBe('');
      const [row] = await orm().select().from(sessions);
      expect(row?.revokedAt).toBeInstanceOf(Date);

      const afterwards = await app.inject({ url: '/api/me', headers });
      expect(afterwards.statusCode).toBe(401);
    });

    it('exige o Origin do sistema: sem ele ou com outro, a sessão não é encerrada', async () => {
      const { app, headers } = await loggedIn();

      for (const origin of [undefined, 'https://evil.test', 'null', `${ORIGIN}.evil.test`]) {
        const response = await app.inject({
          method: 'POST',
          url: '/api/auth/logout',
          headers: { ...headers, ...(origin ? { origin } : {}) },
        });
        expect(response.statusCode, String(origin)).toBe(403);
        expect(response.json()).toMatchObject({ error: { code: 'INVALID_ORIGIN' } });
      }
      expect((await app.inject({ url: '/api/me', headers })).statusCode).toBe(200);
    });

    it('sem sessão, responde 401', async () => {
      const { app } = await makeApp();
      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/logout',
        headers: { origin: ORIGIN },
      });
      expect(response.statusCode).toBe(401);
    });

    it('depois do logout, é possível entrar de novo', async () => {
      const { app, headers } = await loggedIn();
      await app.inject({
        method: 'POST',
        url: '/api/auth/logout',
        headers: { ...headers, origin: ORIGIN },
      });
      const again = await browserLogin(app, IDENTITY);
      expect(sessionCookieOf(again.result)).toBeDefined();
      expect(await orm().select().from(users)).toHaveLength(1);
    });
  });

  describe('com HTTPS', () => {
    const HTTPS_ORIGIN = 'https://chico.example.test';

    it('o cookie usa o prefixo __Host- e o atributo Secure, e o cookie temporário também', async () => {
      const { app } = await makeApp({ config: { appOrigin: HTTPS_ORIGIN } });

      const start = await app.inject('/api/auth/google');
      const temporary = start.cookies.find((c) => c.name === 'chico_oidc');
      expect(temporary).toMatchObject({ secure: true, httpOnly: true, path: '/api/auth' });
      const authorizationUrl = new URL(start.headers.location as string);
      expect(authorizationUrl.searchParams.get('redirect_uri')).toBe(
        `${HTTPS_ORIGIN}/api/auth/google/callback`,
      );

      const callback = await fake.approve(authorizationUrl, IDENTITY);
      const result = await app.inject({
        url: `${callback.pathname}${callback.search}`,
        headers: { cookie: cookieHeader({ chico_oidc: temporary!.value }) },
      });

      expect(result.headers.location).toBe('/');
      const session = result.cookies.find((c) => c.name === '__Host-chico_session');
      expect(session).toMatchObject({ secure: true, httpOnly: true, sameSite: 'Lax', path: '/' });
      expect(session?.domain).toBeUndefined();
      expect(result.cookies.find((c) => c.name === 'chico_session')).toBeUndefined();

      // E esse cookie autentica, com o Origin em HTTPS.
      const me = await app.inject({
        url: '/api/me',
        headers: { cookie: cookieHeader({ '__Host-chico_session': session!.value }) },
      });
      expect(me.statusCode).toBe(200);
      const logout = await app.inject({
        method: 'POST',
        url: '/api/auth/logout',
        headers: {
          cookie: cookieHeader({ '__Host-chico_session': session!.value }),
          origin: HTTPS_ORIGIN,
        },
      });
      expect(logout.statusCode).toBe(204);
    });

    it('não aceita o cookie sem o prefixo, para não confundir sessões de ambientes diferentes', async () => {
      const { app } = await makeApp({ config: { appOrigin: HTTPS_ORIGIN } });
      const user = await insertUser(orm());
      const plain = await app.inject({
        url: '/api/me',
        headers: { cookie: cookieHeader({ chico_session: 'a'.repeat(43) }) },
      });
      expect(plain.statusCode).toBe(401);
      expect(user.id).toBeTruthy();
    });
  });

  describe('limite de tentativas de login', () => {
    it('bloqueia a 31ª tentativa em 15 minutos, com o erro padrão e Retry-After', async () => {
      const { app } = await makeApp({ oidc: null, config: { google: null } });

      for (let attempt = 1; attempt <= 30; attempt++) {
        const response = await app.inject('/api/auth/google');
        expect(response.statusCode, `tentativa ${attempt}`).toBe(302);
      }
      const blocked = await app.inject('/api/auth/google');

      expect(blocked.statusCode).toBe(429);
      expect(blocked.json()).toEqual({
        error: {
          code: 'TOO_MANY_REQUESTS',
          message: 'Muitas solicitações. Tente novamente em instantes.',
        },
      });
      expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    });

    it('a volta do Google tem o mesmo limite, e os contadores não se misturam com outras rotas', async () => {
      const { app } = await makeApp({ oidc: null, config: { google: null } });
      for (let attempt = 1; attempt <= 30; attempt++) {
        await app.inject('/api/auth/google/callback');
      }
      expect((await app.inject('/api/auth/google/callback')).statusCode).toBe(429);
      // Rotas que não são de login não são afetadas.
      expect((await app.inject('/api/health')).statusCode).toBe(200);
    });
  });

  it('não grava o identificador de sessão nem o cookie temporário no log', async () => {
    const { app, output } = await makeApp();
    const { start, result } = await browserLogin(app, IDENTITY);
    const token = sessionCookieOf(result)!.value;
    const temporary = start.cookies.find((c) => c.name === 'chico_oidc')!.value;

    await app.inject({
      url: '/api/me',
      headers: { cookie: cookieHeader({ chico_session: token }) },
    });

    expect(output()).not.toContain(token);
    expect(output()).not.toContain(temporary);
    expect(output()).not.toContain('fulano@prefeitura.example.test');
    expect(output()).toContain('Login concluído');
  });
});
