import { describe, expect, it } from 'vitest';
import { healthResponseSchema } from '@chicochat/shared';
import { buildApp } from '../app';
import { createDatabase } from '../db/client';
import { captureLogger, fakeDb, testConfig } from '../../test/helpers';

describe('GET /api/health', () => {
  it('responde 200 quando o banco responde', async () => {
    const { logger } = captureLogger();
    const app = await buildApp({
      config: testConfig,
      logger,
      db: fakeDb(() => Promise.resolve()),
    });
    const res = await app.inject('/api/health');
    expect(res.statusCode).toBe(200);
    expect(healthResponseSchema.parse(res.json())).toEqual({ status: 'ok', db: 'up' });
  });

  it('responde 503 sem vazar o motivo quando o banco falha', async () => {
    const { logger, output } = captureLogger();
    const app = await buildApp({
      config: testConfig,
      logger,
      db: fakeDb(() => Promise.reject(new Error('ECONNREFUSED 10.0.0.5 senha=hunter2'))),
    });
    const res = await app.inject('/api/health');
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ status: 'degraded', db: 'down' });
    expect(res.body).not.toContain('hunter2');
    expect(output()).toContain('banco indisponível');
  });
});

describe('GET /api/health com PostgreSQL real', () => {
  it('responde 503 quando o banco está desligado', async () => {
    const { logger } = captureLogger();
    // Porta 1: nada escuta lá, equivalente a um banco desligado.
    const db = createDatabase({ databaseUrl: 'postgres://u:p@127.0.0.1:1/nenhum' }, logger);
    const app = await buildApp({ config: testConfig, logger, db });
    const res = await app.inject('/api/health');
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ status: 'degraded', db: 'down' });
    await db.close();
  }, 10_000);

  // Precisa do PostgreSQL do Compose (`npm run db:up`) e de TEST_DATABASE_URL no .env.
  it.skipIf(!process.env.TEST_DATABASE_URL)(
    'responde 200 quando o banco está ligado',
    async () => {
      const { logger } = captureLogger();
      const db = createDatabase({ databaseUrl: process.env.TEST_DATABASE_URL! }, logger);
      const app = await buildApp({ config: testConfig, logger, db });
      const res = await app.inject('/api/health');
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ status: 'ok', db: 'up' });
      await db.close();
    },
    10_000,
  );
});
