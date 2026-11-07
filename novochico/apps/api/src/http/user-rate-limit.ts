import type { FastifyRequest } from 'fastify';
import { AppError } from '../lib/errors';

interface Rule {
  max: number;
  windowMs: number;
}

/**
 * Limites por pessoa (SONNET_CONTEXT, seção K). A rede da Prefeitura tende a compartilhar o IP,
 * então o limite de uma rota cara vale para o usuário logado, não para o endereço. O limite por IP
 * (global e do login) continua no `@fastify/rate-limit`, que roda antes do login e por isso não
 * enxerga quem é a pessoa.
 */
export const USER_LIMITS = {
  /** Mensagens ao agente: custo de IA. */
  messages: [
    { max: 15, windowMs: 60_000 },
    { max: 200, windowMs: 60 * 60_000 },
  ],
  ticketCreate: [{ max: 5, windowMs: 10 * 60_000 }],
  ticketCheck: [{ max: 20, windowMs: 60_000 }],
  ticketsMine: [{ max: 10, windowMs: 60_000 }],
  insights: [{ max: 5, windowMs: 60 * 60_000 }],
  export: [{ max: 5, windowMs: 60_000 }],
} as const satisfies Record<string, readonly Rule[]>;

export type LimitName = keyof typeof USER_LIMITS;

/** Janela deslizante em memória, por (limite, usuário). Uma instância só (ADR-003). */
export function createUserRateLimiter(deps: { now: () => Date }) {
  const hits = new Map<string, number[]>();
  let lastSweep = 0;

  /** Descarta de vez em quando as pessoas que não aparecem mais, para o mapa não crescer. */
  function sweep(at: number): void {
    if (at - lastSweep < 10 * 60_000) return;
    lastSweep = at;
    const longest = 60 * 60_000;
    for (const [key, times] of hits) {
      if (times.every((time) => at - time >= longest)) hits.delete(key);
    }
  }

  /** Conta uma tentativa; passou de algum limite, lança 429 com `Retry-After`. */
  function consume(name: LimitName, userId: string): void {
    const at = deps.now().getTime();
    sweep(at);
    const key = `${name}:${userId}`;
    const rules: readonly Rule[] = USER_LIMITS[name];
    const longest = Math.max(...rules.map((rule) => rule.windowMs));
    const recent = (hits.get(key) ?? []).filter((time) => at - time < longest);

    for (const rule of rules) {
      const inWindow = recent.filter((time) => at - time < rule.windowMs);
      if (inWindow.length >= rule.max) {
        const oldest = Math.min(...inWindow);
        const retryAfterSeconds = Math.max(1, Math.ceil((oldest + rule.windowMs - at) / 1000));
        hits.set(key, recent);
        throw new AppError(
          'RATE_LIMITED',
          429,
          'Muitas solicitações. Tente novamente em alguns instantes.',
          { retryAfterSeconds },
        );
      }
    }
    recent.push(at);
    hits.set(key, recent);
  }

  return {
    consume,
    /** `preHandler` de rota: roda depois do login, então `request.auth` já existe. */
    guard(name: LimitName) {
      return (request: FastifyRequest, _reply: unknown, done: (error?: Error) => void) => {
        try {
          if (request.auth) consume(name, request.auth.user.id);
          done();
        } catch (error) {
          done(error as Error);
        }
      };
    },
  };
}

export type UserRateLimiter = ReturnType<typeof createUserRateLimiter>;
