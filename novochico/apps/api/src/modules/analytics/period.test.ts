import { describe, expect, it } from 'vitest';
import { periodRange } from './metrics';

const iso = (date: Date | null) => date?.toISOString() ?? null;

describe('periodRange', () => {
  // 12:00Z de 02/03/2026 é 09:00 em São Paulo.
  const now = new Date('2026-03-02T12:00:00.000Z');

  it('"hoje" começa à meia-noite de São Paulo', () => {
    expect(iso(periodRange('today', now).from)).toBe('2026-03-02T03:00:00.000Z');
  });

  it('antes das 03:00Z ainda é o dia anterior em São Paulo', () => {
    const early = new Date('2026-03-02T02:30:00.000Z');
    expect(iso(periodRange('today', early).from)).toBe('2026-03-01T03:00:00.000Z');
  });

  it('7, 30 e 90 dias incluem hoje', () => {
    expect(iso(periodRange('7d', now).from)).toBe('2026-02-24T03:00:00.000Z');
    expect(iso(periodRange('30d', now).from)).toBe('2026-02-01T03:00:00.000Z');
    expect(iso(periodRange('90d', now).from)).toBe('2025-12-03T03:00:00.000Z');
  });

  it('"tudo" não tem início', () => {
    expect(periodRange('all', now)).toEqual({ from: null, to: now });
  });
});
