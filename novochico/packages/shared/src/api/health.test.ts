import { describe, expect, it } from 'vitest';
import { healthResponseSchema } from './health';

describe('healthResponseSchema', () => {
  it('aceita os dois estados previstos', () => {
    expect(healthResponseSchema.parse({ status: 'ok', db: 'up' })).toEqual({
      status: 'ok',
      db: 'up',
    });
    expect(healthResponseSchema.parse({ status: 'degraded', db: 'down' }).db).toBe('down');
  });

  it('rejeita valores fora do contrato', () => {
    expect(healthResponseSchema.safeParse({ status: 'ok' }).success).toBe(false);
    expect(healthResponseSchema.safeParse({ status: 'broken', db: 'up' }).success).toBe(false);
  });
});
