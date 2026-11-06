import { LlmError, type LlmChunk, type LlmClient } from '../../integrations/gemini/llm';

/**
 * Proteção da chamada à IA (H.6, ADR-020): limite de conversas simultâneas, tentativas antes do
 * primeiro trecho e disjuntor. Tudo em memória, pois há uma instância só (ADR-003); um reinício
 * zera os contadores, o que é aceitável.
 */
export interface ResilienceOptions {
  /** Conversas simultâneas com a IA. */
  maxConcurrent?: number;
  /** Quanto uma conversa espera por vaga antes de receber "alta demanda". */
  queueWaitMs?: number;
  /** Espera antes de cada tentativa: a primeira é imediata. */
  retryDelaysMs?: readonly number[];
  /** Prazo para o primeiro trecho de cada tentativa. */
  firstChunkTimeoutMs?: number;
  breaker?: {
    /** Quantas chamadas recentes são consideradas. */
    window?: number;
    /** Fração de falhas que abre o disjuntor (acima disso). */
    failureRatio?: number;
    /** Mínimo de chamadas na janela antes de o disjuntor poder abrir. */
    minCalls?: number;
    openMs?: number;
  };
}

const DEFAULTS = {
  maxConcurrent: 8,
  queueWaitMs: 5000,
  retryDelaysMs: [0, 1000, 3000],
  firstChunkTimeoutMs: 25_000,
  breaker: { window: 20, failureRatio: 0.5, minCalls: 10, openMs: 30_000 },
} as const;

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (ms <= 0 || signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    }
    signal.addEventListener('abort', done, { once: true });
  });
}

/** Vagas simultâneas, com fila de espera limitada. */
function createSemaphore(max: number, waitMs: number) {
  let active = 0;
  const waiting: Array<() => void> = [];

  // A vaga de quem sai passa direto ao próximo da fila; sem fila, volta ao conjunto.
  const release = () => {
    const next = waiting.shift();
    if (next) next();
    else active -= 1;
  };

  return {
    /** Devolve a função que libera a vaga, ou nulo se a espera acabou sem vaga. */
    async acquire(): Promise<(() => void) | null> {
      if (active < max) {
        active += 1;
        return release;
      }

      let grant: () => void = () => undefined;
      const granted = new Promise<true>((resolve) => {
        grant = () => resolve(true);
      });
      waiting.push(grant);

      const timer = new AbortController();
      const expired = sleep(waitMs, timer.signal).then(() => false as const);
      const got = await Promise.race([granted, expired]);
      timer.abort();
      if (got) return release;

      const position = waiting.indexOf(grant);
      if (position >= 0) {
        waiting.splice(position, 1);
        return null;
      }
      // A vaga foi entregue no mesmo instante em que o prazo acabou: aproveita.
      return release;
    },
  };
}

function createBreaker(
  settings: Required<NonNullable<ResilienceOptions['breaker']>>,
  now: () => number,
) {
  const outcomes: boolean[] = [];
  let openUntil = 0;

  return {
    isOpen: () => now() < openUntil,
    record(success: boolean) {
      outcomes.push(success);
      if (outcomes.length > settings.window) outcomes.shift();
      if (outcomes.length < settings.minCalls) return;
      const failures = outcomes.filter((ok) => !ok).length;
      if (failures / outcomes.length > settings.failureRatio) {
        openUntil = now() + settings.openMs;
        outcomes.length = 0;
      }
    },
  };
}

/** Falha se o primeiro trecho não chegar no prazo, cancelando a tentativa. */
async function nextWithin<T>(
  iterator: AsyncIterator<T>,
  ms: number,
  abort: () => void,
): Promise<IteratorResult<T>> {
  const timer = new AbortController();
  const expired = sleep(ms, timer.signal).then(() => 'timeout' as const);
  const result = await Promise.race([iterator.next(), expired]);
  timer.abort();
  if (result === 'timeout') {
    abort();
    throw new LlmError('timeout');
  }
  return result;
}

export function withResilience(inner: LlmClient, options: ResilienceOptions = {}): LlmClient {
  const maxConcurrent = options.maxConcurrent ?? DEFAULTS.maxConcurrent;
  const queueWaitMs = options.queueWaitMs ?? DEFAULTS.queueWaitMs;
  const delays = options.retryDelaysMs ?? DEFAULTS.retryDelaysMs;
  const firstChunkTimeoutMs = options.firstChunkTimeoutMs ?? DEFAULTS.firstChunkTimeoutMs;
  const breaker = createBreaker({ ...DEFAULTS.breaker, ...options.breaker }, Date.now);
  const semaphore = createSemaphore(maxConcurrent, queueWaitMs);

  return {
    // Resposta estruturada não passa pela fila: quem pede (o resumo) tem as próprias tentativas.
    generateJson: (input) => inner.generateJson(input),

    async *streamChat(input): AsyncGenerator<LlmChunk> {
      // Disjuntor aberto: falha na hora, sem gastar a vaga nem a paciência do usuário.
      if (breaker.isOpen()) throw new LlmError('unavailable', { retryable: false });

      const release = await semaphore.acquire();
      if (!release) throw new LlmError('busy', { retryAfterMs: 5000, retryable: false });

      try {
        let lastError: LlmError | undefined;

        for (const delay of delays) {
          if (input.signal.aborted) throw new LlmError('aborted', { retryable: false });
          await sleep(delay, input.signal);
          if (input.signal.aborted) throw new LlmError('aborted', { retryable: false });

          const attempt = new AbortController();
          const onAbort = () => attempt.abort();
          input.signal.addEventListener('abort', onAbort, { once: true });
          const stream = inner.streamChat({ ...input, signal: attempt.signal });
          const iterator = stream[Symbol.asyncIterator]();

          let first: IteratorResult<LlmChunk>;
          try {
            first = await nextWithin(iterator, firstChunkTimeoutMs, () => attempt.abort());
          } catch (error) {
            input.signal.removeEventListener('abort', onAbort);
            const failure =
              error instanceof LlmError ? error : new LlmError('unavailable', { cause: error });
            if (failure.kind === 'aborted') throw failure;
            breaker.record(false);
            lastError = failure;
            if (!failure.retryable) throw failure;
            continue;
          }

          // Daqui em diante já há texto: nada é tentado de novo, e uma falha vai ao usuário.
          try {
            let current = first;
            while (!current.done) {
              yield current.value;
              current = await iterator.next();
            }
            breaker.record(true);
            return;
          } catch (error) {
            const failure =
              error instanceof LlmError ? error : new LlmError('unavailable', { cause: error });
            if (failure.kind !== 'aborted') breaker.record(false);
            throw failure;
          } finally {
            input.signal.removeEventListener('abort', onAbort);
            attempt.abort();
          }
        }

        throw lastError ?? new LlmError('unavailable');
      } finally {
        release();
      }
    },
  };
}
