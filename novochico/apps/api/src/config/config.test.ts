import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from './index';

const VALID = { DATABASE_URL: 'postgres://chico:dev@127.0.0.1:5433/chicochat' };

describe('loadConfig', () => {
  it('aplica os padrões quando só o obrigatório é informado', () => {
    expect(loadConfig(VALID)).toEqual({
      env: 'development',
      host: '127.0.0.1',
      port: 3000,
      logLevel: 'info',
      databaseUrl: VALID.DATABASE_URL,
    });
  });

  it('aceita uma URL de migrations separada, mas só se for postgres', () => {
    const migration = 'postgres://migrador:dev@127.0.0.1:5433/chicochat';
    expect(loadConfig(VALID).databaseMigrationUrl).toBeUndefined();
    expect(loadConfig({ ...VALID, DATABASE_MIGRATION_URL: migration }).databaseMigrationUrl).toBe(
      migration,
    );
    expect(() => loadConfig({ ...VALID, DATABASE_MIGRATION_URL: 'http://x' })).toThrowError(
      'DATABASE_MIGRATION_URL: valor inválido',
    );
  });

  it('converte a porta e aceita variáveis opcionais', () => {
    const config = loadConfig({ ...VALID, PORT: '3100', LOG_LEVEL: 'debug', NODE_ENV: 'test' });
    expect(config.port).toBe(3100);
    expect(config.logLevel).toBe('debug');
    expect(config.env).toBe('test');
  });

  it('trata variável vazia como ausente', () => {
    expect(loadConfig({ ...VALID, PORT: '' }).port).toBe(3000);
  });

  it('falha apontando a variável obrigatória ausente', () => {
    expect(() => loadConfig({})).toThrowError(ConfigError);
    expect(() => loadConfig({})).toThrowError('DATABASE_URL: ausente');
  });

  it('falha com valores inválidos, citando só o nome da variável', () => {
    try {
      loadConfig({ ...VALID, PORT: 'abc', LOG_LEVEL: 'barulhento' });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      expect((error as ConfigError).variables.sort()).toEqual(['LOG_LEVEL', 'PORT']);
    }
  });

  it('nunca inclui o valor secreto na mensagem de erro', () => {
    const senha = 'senha-super-secreta-123';
    for (const value of [`mysql://u:${senha}@host/db`, `não é uma url ${senha}`]) {
      try {
        loadConfig({ DATABASE_URL: value });
        expect.unreachable();
      } catch (error) {
        const message = (error as Error).message;
        expect(message).toContain('DATABASE_URL: valor inválido');
        expect(message).not.toContain(senha);
      }
    }
  });

  it('só aceita URL postgres', () => {
    expect(() => loadConfig({ DATABASE_URL: 'http://localhost/db' })).toThrowError(ConfigError);
    expect(loadConfig({ DATABASE_URL: 'postgresql://u:p@h/db' }).databaseUrl).toBeTruthy();
  });
});
