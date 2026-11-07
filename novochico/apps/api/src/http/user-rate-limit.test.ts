import { describe, expect, it } from 'vitest';
import { AppError } from '../lib/errors';
import { createUserRateLimiter, USER_LIMITS, type LimitName } from './user-rate-limit';

const SECOND = 1000;
const MINUTE = 60 * SECOND;

function setup() {
  let current = new Date('2026-03-02T12:00:00.000Z');
  const limiter = createUserRateLimiter({ now: () => current });
  return {
    limiter,
    advance: (ms: number) => {
      current = new Date(current.getTime() + ms);
    },
  };
}

function attempt(limiter: ReturnType<typeof setup>['limiter'], name: LimitName, user: string) {
  try {
    limiter.consume(name, user);
    return null;
  } catch (error) {
    return error as AppError;
  }
}

describe('limites por usuário (seção K)', () => {
  it('a tabela segue o documento', () => {
    expect(USER_LIMITS.messages).toEqual([
      { max: 15, windowMs: MINUTE },
      { max: 200, windowMs: 60 * MINUTE },
    ]);
    expect(USER_LIMITS.ticketCreate).toEqual([{ max: 5, windowMs: 10 * MINUTE }]);
    expect(USER_LIMITS.ticketCheck).toEqual([{ max: 20, windowMs: MINUTE }]);
    expect(USER_LIMITS.ticketsMine).toEqual([{ max: 10, windowMs: MINUTE }]);
    expect(USER_LIMITS.insights).toEqual([{ max: 5, windowMs: 60 * MINUTE }]);
    expect(USER_LIMITS.export).toEqual([{ max: 5, windowMs: MINUTE }]);
  });

  it.each([
    ['messages', 15],
    ['ticketCreate', 5],
    ['ticketCheck', 20],
    ['ticketsMine', 10],
    ['insights', 5],
    ['export', 5],
  ] as const)('%s: passa até %i e recusa a seguinte com 429', (name, max) => {
    const { limiter } = setup();
    for (let i = 0; i < max; i++)
      expect(attempt(limiter, name, 'u1'), `tentativa ${i + 1}`).toBeNull();
    const blocked = attempt(limiter, name, 'u1');
    expect(blocked).toBeInstanceOf(AppError);
    expect(blocked).toMatchObject({ statusCode: 429, code: 'RATE_LIMITED' });
    expect(blocked?.retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });

  it('é por usuário e por limite: um não afeta o outro', () => {
    const { limiter } = setup();
    for (let i = 0; i < 5; i++) limiter.consume('export', 'u1');
    expect(attempt(limiter, 'export', 'u1')).not.toBeNull();
    expect(attempt(limiter, 'export', 'u2')).toBeNull();
    expect(attempt(limiter, 'insights', 'u1')).toBeNull();
  });

  it('o limite volta quando a janela passa, e Retry-After diz quanto falta', () => {
    const { limiter, advance } = setup();
    for (let i = 0; i < 5; i++) limiter.consume('export', 'u1');
    advance(20 * SECOND);
    expect(attempt(limiter, 'export', 'u1')?.retryAfterSeconds).toBe(40);
    advance(40 * SECOND);
    expect(attempt(limiter, 'export', 'u1')).toBeNull();
  });

  it('mensagens: o limite por hora vale mesmo respeitando o de cada minuto', () => {
    const { limiter, advance } = setup();
    let sent = 0;
    // 14 por minuto, a cada minuto: nunca passa de 15 por minuto, mas passa de 200 por hora.
    let blockedAt = -1;
    for (let minute = 0; minute < 30 && blockedAt < 0; minute++) {
      for (let i = 0; i < 14; i++) {
        if (attempt(limiter, 'messages', 'u1')) {
          blockedAt = sent;
          break;
        }
        sent++;
      }
      advance(MINUTE);
    }
    expect(blockedAt).toBe(200);
  });

  it('recusar não gasta o limite: depois de passar a janela, tudo volta', () => {
    const { limiter, advance } = setup();
    for (let i = 0; i < 5; i++) limiter.consume('export', 'u1');
    for (let i = 0; i < 50; i++) attempt(limiter, 'export', 'u1');
    advance(61 * SECOND);
    for (let i = 0; i < 5; i++) expect(attempt(limiter, 'export', 'u1')).toBeNull();
  });

  it('quem não é mais visto some da memória', () => {
    const { limiter, advance } = setup();
    for (let i = 0; i < 100; i++) limiter.consume('ticketsMine', `u${i}`);
    advance(2 * 60 * MINUTE);
    // Qualquer chamada dispara a varredura; os usuários antigos já não contam.
    limiter.consume('ticketsMine', 'novo');
    for (let i = 0; i < 10; i++) expect(attempt(limiter, 'ticketsMine', `u${i}`)).toBeNull();
  });
});
