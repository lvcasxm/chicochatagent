import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app';
import type { Config } from '../config';
import { captureLogger, fakeDb, testConfig } from '../../test/helpers';

const INDEX = '<!doctype html><html><body><div id="root"></div></body></html>';

function makeDist(): string {
  const dir = mkdtempSync(join(tmpdir(), 'chico-dist-'));
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'index.html'), INDEX);
  writeFileSync(join(dir, 'theme-init.js'), 'document.documentElement.dataset.theme = "light";');
  writeFileSync(join(dir, 'assets', 'index-abc123.js'), 'console.log("app");');
  writeFileSync(join(dir, '.segredo'), 'nao-entregar');
  return dir;
}

async function app(config: Partial<Config> = {}): Promise<FastifyInstance> {
  const { logger } = captureLogger();
  return buildApp({
    config: { ...testConfig, ...config },
    logger,
    db: fakeDb(() => Promise.resolve()),
    oidc: null,
  });
}

/** Diretivas da CSP como um mapa nome -> valores. */
function directives(csp: string | string[] | undefined): Map<string, string[]> {
  const text = Array.isArray(csp) ? csp.join(';') : (csp ?? '');
  return new Map(
    text
      .split(';')
      .map((part) => part.trim().split(/\s+/))
      .filter((parts) => parts[0])
      .map(([name, ...values]) => [name as string, values]),
  );
}

describe('cabeçalhos de segurança', () => {
  it('a política de conteúdo só aceita a própria origem e nenhum script em linha', async () => {
    const server = await app();
    const response = await server.inject('/api/health');
    const csp = directives(response.headers['content-security-policy']);

    expect(csp.get('default-src')).toEqual(["'self'"]);
    expect(csp.get('script-src')).toEqual(["'self'"]);
    expect(csp.get('script-src')).not.toContain("'unsafe-inline'");
    expect(csp.get('script-src')).not.toContain("'unsafe-eval'");
    expect(csp.get('object-src')).toEqual(["'none'"]);
    expect(csp.get('frame-ancestors')).toEqual(["'none'"]);
    expect(csp.get('base-uri')).toEqual(["'self'"]);
    expect(csp.get('form-action')).toEqual(["'self'"]);
    expect(csp.get('connect-src')).toEqual(["'self'"]);
    // Nenhuma diretiva abre para outra origem.
    for (const [name, values] of csp) {
      expect(
        values.every((value) => value.startsWith("'") || value === 'data:'),
        `${name}: ${values.join(' ')}`,
      ).toBe(true);
    }
  });

  it('demais cabeçalhos: tipo, referência, quadros, permissões e origem cruzada', async () => {
    const response = await (await app()).inject('/api/health');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['referrer-policy']).toBe('no-referrer');
    expect(response.headers['x-frame-options']).toBeDefined();
    expect(response.headers['permissions-policy']).toContain('camera=()');
    expect(response.headers['cross-origin-opener-policy']).toBe('same-origin');
    expect(response.headers['cross-origin-resource-policy']).toBe('same-origin');
    expect(response.headers['x-powered-by']).toBeUndefined();
  });

  it('HSTS só com endereço https; em http, não', async () => {
    const http = await (await app()).inject('/api/health');
    expect(http.headers['strict-transport-security']).toBeUndefined();
    expect(
      directives(http.headers['content-security-policy']).has('upgrade-insecure-requests'),
    ).toBe(false);

    const https = await (
      await app({ appOrigin: 'https://chico.example.test' })
    ).inject('/api/health');
    expect(https.headers['strict-transport-security']).toBe('max-age=31536000; includeSubDomains');
    expect(
      directives(https.headers['content-security-policy']).has('upgrade-insecure-requests'),
    ).toBe(true);
  });

  it('respostas da API não ficam em cache; erros também', async () => {
    const server = await app();
    expect((await server.inject('/api/health')).headers['cache-control']).toBe('no-store');
    const anonymous = await server.inject('/api/me');
    expect(anonymous.statusCode).toBe(401);
    expect(anonymous.headers['cache-control']).toBe('no-store');
  });

  it('rota inexistente na API: 404 em JSON, sem login e sem HTML', async () => {
    const response = await (await app()).inject('/api/nao-existe');
    expect(response.statusCode).toBe(404);
    expect(response.headers['content-type']).toContain('application/json');
  });
});

describe('interface servida pela API', () => {
  let dist: string;
  let server: FastifyInstance;

  beforeAll(async () => {
    dist = makeDist();
    server = await app({ webDistDir: dist });
  });
  afterAll(() => rmSync(dist, { recursive: true, force: true }));

  it('a raiz e os endereços da interface recebem o índice, com os cabeçalhos de segurança', async () => {
    for (const path of [
      '/',
      '/admin/instrucoes',
      '/c/3f9a1c52-8d4e-4b7a-9c1e-2a6b5d8e0f13',
      '/chamados?x=1',
    ]) {
      const response = await server.inject(path);
      expect(response.statusCode, path).toBe(200);
      expect(response.body, path).toBe(INDEX);
      expect(response.headers['content-type'], path).toContain('text/html');
      expect(response.headers['cache-control'], path).toBe('no-cache');
      expect(response.headers['content-security-policy'], path).toContain("script-src 'self'");
    }
  });

  it('arquivos com hash ficam em cache por um ano; os demais, sempre revalidados', async () => {
    const asset = await server.inject('/assets/index-abc123.js');
    expect(asset.statusCode).toBe(200);
    expect(asset.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    const theme = await server.inject('/theme-init.js');
    expect(theme.statusCode).toBe(200);
    expect(theme.headers['cache-control']).toBe('no-cache');
  });

  it('arquivo inexistente é 404 em JSON, não o índice', async () => {
    for (const path of ['/assets/nao-existe.js', '/favicon-falso.png']) {
      const response = await server.inject(path);
      expect(response.statusCode, path).toBe(404);
      expect(response.headers['content-type'], path).toContain('application/json');
    }
  });

  it('não entrega arquivos ocultos nem sai da pasta', async () => {
    for (const path of [
      '/.segredo',
      '/assets/../../package.json',
      '/%2e%2e/package.json',
      '/..%2f..%2fpackage.json',
    ]) {
      const response = await server.inject(path);
      expect(response.body, path).not.toContain('nao-entregar');
      expect([400, 404], path).toContain(response.statusCode);
    }
  });

  it('a API continua protegida e à frente: login exigido, 404 próprio', async () => {
    expect((await server.inject('/api/me')).statusCode).toBe(401);
    expect((await server.inject('/api/admin/metrics')).statusCode).toBe(401);
    expect((await server.inject('/api/nao-existe')).statusCode).toBe(404);
    expect((await server.inject('/api/health')).statusCode).toBe(200);
  });

  it('escritas continuam exigindo o Origin; o índice não responde a POST', async () => {
    expect((await server.inject({ method: 'POST', url: '/admin' })).statusCode).toBe(403);
    const withOrigin = await server.inject({
      method: 'POST',
      url: '/admin',
      headers: { origin: testConfig.appOrigin },
    });
    expect(withOrigin.statusCode).toBe(404);
  });

  it('sem build, a partida falha em vez de servir erro a cada requisição', async () => {
    await expect(app({ webDistDir: join(dist, 'nao-existe') })).rejects.toThrow();
  });
});

describe('limite por IP e proxy confiável', () => {
  it('global: 600 por minuto por IP; o 601º recebe 429 com Retry-After', async () => {
    const server = await app();
    let last = 200;
    for (let i = 0; i < 601; i++) last = (await server.inject('/api/health')).statusCode;
    expect(last).toBe(429);
    const blocked = await server.inject('/api/health');
    expect(blocked.statusCode).toBe(429);
    expect(blocked.headers['retry-after']).toBeDefined();
    expect(blocked.json()).toMatchObject({ error: { code: 'TOO_MANY_REQUESTS' } });
  });

  it('login: 30 por 15 minutos por IP; o cabeçalho X-Forwarded-For é ignorado sem proxy confiável', async () => {
    const server = await app({ trustProxy: false });
    const statuses: number[] = [];
    for (let i = 0; i < 31; i++) {
      const response = await server.inject({
        url: '/api/auth/google',
        headers: { 'x-forwarded-for': `203.0.113.${i + 1}` },
      });
      statuses.push(response.statusCode);
    }
    expect(statuses.slice(0, 30).every((status) => status !== 429)).toBe(true);
    expect(statuses[30]).toBe(429);
  });

  it('atrás de proxy confiável, cada cliente tem o próprio limite', async () => {
    const server = await app({ trustProxy: true });
    const statuses: number[] = [];
    for (let i = 0; i < 40; i++) {
      const response = await server.inject({
        url: '/api/auth/google',
        headers: { 'x-forwarded-for': `203.0.113.${i + 1}` },
      });
      statuses.push(response.statusCode);
    }
    expect(statuses).not.toContain(429);

    // E o mesmo cliente continua limitado.
    const same: number[] = [];
    for (let i = 0; i < 31; i++) {
      same.push(
        (
          await server.inject({
            url: '/api/auth/google',
            headers: { 'x-forwarded-for': '198.51.100.7' },
          })
        ).statusCode,
      );
    }
    expect(same[30]).toBe(429);
  });
});

describe('sem CORS e sem identificadores institucionais (S-17, S-18)', () => {
  it('nenhuma resposta libera outra origem', async () => {
    const server = await app();
    const origin = 'https://site-de-terceiro.example.test';
    const get = await server.inject({ url: '/api/health', headers: { origin } });
    expect(get.headers['access-control-allow-origin']).toBeUndefined();
    const preflight = await server.inject({
      method: 'OPTIONS',
      url: '/api/me',
      headers: {
        origin,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type',
      },
    });
    expect(preflight.headers['access-control-allow-origin']).toBeUndefined();
    expect(preflight.headers['access-control-allow-credentials']).toBeUndefined();
  });

  it('o código, as migrations e os seeds não têm e-mail nem domínio institucional real', () => {
    const root = join(import.meta.dirname, '..', '..', '..', '..');
    const domain = ['pedro', 'leopoldo.mg.gov.br'].join('');
    // Canais públicos de atendimento, citados de propósito nas instruções iniciais (ADR-045).
    const publicChannels = [`suporte.sei@${domain}`, `sei.${domain}`];
    const folders = ['apps/api/src', 'apps/api/drizzle', 'apps/web/src', 'packages/shared/src'];
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (/\.(ts|tsx|sql|json|css|html)$/.test(entry.name)) {
          const text = publicChannels.reduce(
            (current, channel) => current.split(channel).join(''),
            readFileSync(path, 'utf8').toLowerCase(),
          );
          if (text.includes(domain)) hits.push(path);
        }
      }
    };
    for (const folder of folders) walk(join(root, folder));
    expect(hits).toEqual([]);
  });
});
