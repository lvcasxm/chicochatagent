import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from './index';

const SESSION_SECRET = 'segredo-de-teste-com-mais-de-trinta-e-dois-caracteres';

const VALID = {
  DATABASE_URL: 'postgres://chico:dev@127.0.0.1:5433/chicochat',
  APP_PUBLIC_URL: 'http://127.0.0.1:5173',
  SESSION_SECRET,
  ALLOWED_EMAIL_DOMAINS: 'prefeitura.example.test',
};

function failureOf(env: Record<string, string | undefined>): ConfigError {
  try {
    loadConfig(env);
  } catch (error) {
    if (error instanceof ConfigError) return error;
    throw error;
  }
  throw new Error('A configuração deveria ter falhado.');
}

describe('loadConfig', () => {
  it('aplica os padrões quando só o obrigatório é informado', () => {
    expect(loadConfig(VALID)).toEqual({
      env: 'development',
      host: '127.0.0.1',
      port: 3000,
      logLevel: 'info',
      trustProxy: false,
      databaseUrl: VALID.DATABASE_URL,
      databaseMigrationUrl: undefined,
      appOrigin: 'http://127.0.0.1:5173',
      sessionSecret: SESSION_SECRET,
      allowedEmailDomains: ['prefeitura.example.test'],
      google: null,
      ai: { provider: 'gemini', apiKey: undefined, chatModel: 'gemini-3.1-flash-lite' },
      chatCacheEnabled: true,
      glpiPortalUrl: null,
    });
  });

  it('configura a IA: chave, modelo, cache e portal; o fake é recusado em produção', () => {
    const config = loadConfig({
      ...VALID,
      GEMINI_API_KEY: 'chave-ficticia',
      GEMINI_CHAT_MODEL: 'modelo-x',
      CHAT_CACHE_ENABLED: 'false',
      GLPI_PORTAL_URL: 'https://chamados.example.test/',
    });
    expect(config.ai).toEqual({
      provider: 'gemini',
      apiKey: 'chave-ficticia',
      chatModel: 'modelo-x',
    });
    expect(config.chatCacheEnabled).toBe(false);
    expect(config.glpiPortalUrl).toBe('https://chamados.example.test/');
    expect(loadConfig({ ...VALID, AI_PROVIDER: 'fake' }).ai).toEqual({ provider: 'fake' });
    expect(() =>
      loadConfig({
        ...VALID,
        NODE_ENV: 'production',
        AI_PROVIDER: 'fake',
        APP_PUBLIC_URL: 'https://chico.example.test',
        SESSION_SECRET: 'x'.repeat(40),
      }),
    ).toThrow(/AI_PROVIDER/);
    expect(() => loadConfig({ ...VALID, GLPI_PORTAL_URL: 'javascript:alert(1)' })).toThrow(
      /GLPI_PORTAL_URL/,
    );
  });

  it('converte a porta e aceita variáveis opcionais', () => {
    const config = loadConfig({
      ...VALID,
      PORT: '3100',
      LOG_LEVEL: 'debug',
      NODE_ENV: 'test',
      TRUST_PROXY: 'true',
    });
    expect(config.port).toBe(3100);
    expect(config.logLevel).toBe('debug');
    expect(config.env).toBe('test');
    expect(config.trustProxy).toBe(true);
  });

  it('trata variável vazia como ausente', () => {
    expect(loadConfig({ ...VALID, PORT: '' }).port).toBe(3000);
  });

  it('falha apontando todas as variáveis obrigatórias ausentes', () => {
    const error = failureOf({});
    expect(error.variables.sort()).toEqual([
      'ALLOWED_EMAIL_DOMAINS',
      'APP_PUBLIC_URL',
      'DATABASE_URL',
      'SESSION_SECRET',
    ]);
    expect(error.message).toContain('DATABASE_URL: ausente');
  });

  it('falha com valores inválidos, citando só o nome da variável', () => {
    const error = failureOf({ ...VALID, PORT: 'abc', LOG_LEVEL: 'barulhento' });
    expect(error.variables.sort()).toEqual(['LOG_LEVEL', 'PORT']);
  });

  it('nunca inclui valores secretos na mensagem de erro', () => {
    const senha = 'senha-super-secreta-123';
    for (const value of [`mysql://u:${senha}@host/db`, `não é uma url ${senha}`]) {
      const message = failureOf({ ...VALID, DATABASE_URL: value }).message;
      expect(message).toContain('DATABASE_URL: valor inválido');
      expect(message).not.toContain(senha);
    }
    const curto = failureOf({ ...VALID, SESSION_SECRET: 'curto-demais' });
    expect(curto.message).not.toContain('curto-demais');
  });

  it('só aceita URL postgres', () => {
    expect(failureOf({ ...VALID, DATABASE_URL: 'http://localhost/db' }).variables).toEqual([
      'DATABASE_URL',
    ]);
    expect(
      loadConfig({ ...VALID, DATABASE_URL: 'postgresql://u:p@h/db' }).databaseUrl,
    ).toBeTruthy();
  });

  it('aceita uma URL de migrations separada, mas só se for postgres', () => {
    const migration = 'postgres://migrador:dev@127.0.0.1:5433/chicochat';
    expect(loadConfig({ ...VALID, DATABASE_MIGRATION_URL: migration }).databaseMigrationUrl).toBe(
      migration,
    );
    expect(failureOf({ ...VALID, DATABASE_MIGRATION_URL: 'http://x' }).variables).toEqual([
      'DATABASE_MIGRATION_URL',
    ]);
  });

  describe('endereço público', () => {
    it('guarda só a origem, sem barra final', () => {
      expect(
        loadConfig({ ...VALID, APP_PUBLIC_URL: 'https://chico.example.test/' }).appOrigin,
      ).toBe('https://chico.example.test');
    });

    it('recusa caminho, query e esquemas que não sejam http(s)', () => {
      for (const value of [
        'https://x.test/chico',
        'https://x.test/?a=1',
        'ftp://x.test',
        'x.test',
      ]) {
        expect(failureOf({ ...VALID, APP_PUBLIC_URL: value }).variables, value).toEqual([
          'APP_PUBLIC_URL',
        ]);
      }
    });
  });

  describe('segredo de sessão', () => {
    it('exige pelo menos 32 caracteres', () => {
      expect(failureOf({ ...VALID, SESSION_SECRET: 'a'.repeat(31) }).variables).toEqual([
        'SESSION_SECRET',
      ]);
      expect(loadConfig({ ...VALID, SESSION_SECRET: 'a'.repeat(32) }).sessionSecret).toHaveLength(
        32,
      );
    });
  });

  describe('domínios permitidos', () => {
    it('normaliza, ignora espaços e aceita vários', () => {
      const config = loadConfig({
        ...VALID,
        ALLOWED_EMAIL_DOMAINS: ' Prefeitura.Example.test , outro.example.test ,',
      });
      expect(config.allowedEmailDomains).toEqual(['prefeitura.example.test', 'outro.example.test']);
    });

    it('recusa lista vazia e domínios malformados', () => {
      for (const value of [' , ', 'semponto', '@prefeitura.test', 'a b.test', '*.test']) {
        expect(failureOf({ ...VALID, ALLOWED_EMAIL_DOMAINS: value }).variables, value).toEqual([
          'ALLOWED_EMAIL_DOMAINS',
        ]);
      }
    });
  });

  describe('credenciais do Google', () => {
    const GOOGLE = { GOOGLE_CLIENT_ID: 'id-de-teste', GOOGLE_CLIENT_SECRET: 'segredo-de-teste' };

    it('ficam nulas quando não configuradas', () => {
      expect(loadConfig(VALID).google).toBeNull();
    });

    it('são lidas em conjunto, com a dica de domínio opcional', () => {
      expect(loadConfig({ ...VALID, ...GOOGLE }).google).toEqual({
        clientId: 'id-de-teste',
        clientSecret: 'segredo-de-teste',
        hostedDomain: undefined,
      });
      const hinted = loadConfig({
        ...VALID,
        ...GOOGLE,
        GOOGLE_HOSTED_DOMAIN: 'prefeitura.example.test',
      });
      expect(hinted.google?.hostedDomain).toBe('prefeitura.example.test');
    });

    it('exigem os dois valores juntos', () => {
      expect(failureOf({ ...VALID, GOOGLE_CLIENT_ID: 'x' }).variables).toEqual([
        'GOOGLE_CLIENT_SECRET',
      ]);
      expect(failureOf({ ...VALID, GOOGLE_CLIENT_SECRET: 'x' }).variables).toEqual([
        'GOOGLE_CLIENT_ID',
      ]);
    });
  });

  describe('em produção', () => {
    const PROD = { ...VALID, NODE_ENV: 'production', APP_PUBLIC_URL: 'https://chico.example.test' };

    it('aceita uma configuração completa', () => {
      expect(loadConfig(PROD).env).toBe('production');
    });

    it('recusa o segredo de exemplo do .env.example', () => {
      const error = failureOf({ ...PROD, SESSION_SECRET: `troque-${'x'.repeat(40)}` });
      expect(error.variables).toEqual(['SESSION_SECRET']);
    });

    it('exige endereço público em https', () => {
      expect(failureOf({ ...PROD, APP_PUBLIC_URL: 'http://chico.example.test' }).variables).toEqual(
        ['APP_PUBLIC_URL'],
      );
    });
  });
});
