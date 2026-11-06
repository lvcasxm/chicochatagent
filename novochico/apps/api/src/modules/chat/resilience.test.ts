import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LlmError, type LlmChunk, type LlmClient } from '../../integrations/gemini/llm';
import { withResilience } from './resilience';

const INPUT = { system: 's', messages: [{ role: 'user' as const, content: 'oi' }] };

async function collect(stream: AsyncIterable<LlmChunk>): Promise<string> {
  let text = '';
  for await (const chunk of stream) if (chunk.type === 'text') text += chunk.text;
  return text;
}

/** Cliente cujas chamadas seguem uma lista de comportamentos, uma por tentativa. */
function clientWith(behaviors: Array<(signal: AbortSignal) => AsyncGenerator<LlmChunk>>) {
  let calls = 0;
  const client: LlmClient = {
    streamChat: ({ signal }) => {
      const behavior = behaviors[calls++] ?? behaviors.at(-1);
      if (!behavior) throw new Error('sem comportamento');
      return behavior(signal);
    },
  };
  return { client, calls: () => calls };
}

const ok = (text: string) =>
  async function* (): AsyncGenerator<LlmChunk> {
    yield { type: 'text', text };
    yield { type: 'end' };
  };

const fail = (error: LlmError) =>
  async function* (): AsyncGenerator<LlmChunk> {
    throw error;
  };

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-03-02T12:00:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
});

describe('tentativas', () => {
  it('sucesso na primeira: uma chamada, sem espera', async () => {
    const { client, calls } = clientWith([ok('Olá')]);
    const llm = withResilience(client);
    const text = await collect(llm.streamChat({ ...INPUT, signal: new AbortController().signal }));
    expect(text).toBe('Olá');
    expect(calls()).toBe(1);
  });

  it('tenta de novo em 429, 5xx e rede, com esperas de 1 e 3 segundos', async () => {
    const { client, calls } = clientWith([
      fail(new LlmError('rate_limited')),
      fail(new LlmError('unavailable')),
      ok('Funcionou'),
    ]);
    const llm = withResilience(client);
    const pending = collect(llm.streamChat({ ...INPUT, signal: new AbortController().signal }));

    await vi.advanceTimersByTimeAsync(0);
    expect(calls()).toBe(1);
    await vi.advanceTimersByTimeAsync(999);
    expect(calls()).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls()).toBe(2);
    await vi.advanceTimersByTimeAsync(2999);
    expect(calls()).toBe(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toBe('Funcionou');
    expect(calls()).toBe(3);
  });

  it('desiste depois de três tentativas e entrega o último erro', async () => {
    const { client, calls } = clientWith([fail(new LlmError('unavailable'))]);
    const llm = withResilience(client);
    const result = collect(
      llm.streamChat({ ...INPUT, signal: new AbortController().signal }),
    ).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(10_000);
    const error = await result;
    expect(error).toBeInstanceOf(LlmError);
    expect(calls()).toBe(3);
  });

  it('erro que não adianta repetir (chave inválida) falha na hora', async () => {
    const { client, calls } = clientWith([fail(new LlmError('unavailable', { retryable: false }))]);
    const llm = withResilience(client);
    const error = await collect(
      llm.streamChat({ ...INPUT, signal: new AbortController().signal }),
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LlmError);
    expect(calls()).toBe(1);
  });

  it('depois do primeiro trecho nunca tenta de novo: a falha vai ao usuário', async () => {
    const midway = async function* (): AsyncGenerator<LlmChunk> {
      yield { type: 'text', text: 'Parcial' };
      throw new LlmError('unavailable');
    };
    const { client, calls } = clientWith([midway, ok('Outra')]);
    const llm = withResilience(client);
    const received: string[] = [];
    const error = await (async () => {
      try {
        for await (const chunk of llm.streamChat({
          ...INPUT,
          signal: new AbortController().signal,
        })) {
          if (chunk.type === 'text') received.push(chunk.text);
        }
      } catch (e) {
        return e;
      }
      return null;
    })();
    expect(received).toEqual(['Parcial']);
    expect(error).toBeInstanceOf(LlmError);
    expect(calls()).toBe(1);
  });

  it('sem primeiro trecho em 25 segundos, cancela a tentativa e tenta de novo', async () => {
    const abortedSignals: boolean[] = [];
    const hang = async function* (signal: AbortSignal): AsyncGenerator<LlmChunk> {
      await new Promise<void>((resolve) => {
        signal.addEventListener('abort', () => {
          abortedSignals.push(true);
          resolve();
        });
      });
      yield { type: 'text', text: 'tarde demais' };
    };
    const { client, calls } = clientWith([hang, ok('Segunda')]);
    const llm = withResilience(client);
    const pending = collect(llm.streamChat({ ...INPUT, signal: new AbortController().signal }));
    await vi.advanceTimersByTimeAsync(25_000);
    expect(abortedSignals).toEqual([true]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await pending).toBe('Segunda');
    expect(calls()).toBe(2);
  });

  it('cliente que desiste não gera nova tentativa', async () => {
    const controller = new AbortController();
    const { client, calls } = clientWith([fail(new LlmError('unavailable'))]);
    const llm = withResilience(client);
    const result = collect(llm.streamChat({ ...INPUT, signal: controller.signal })).catch(
      (e: unknown) => e,
    );
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await vi.advanceTimersByTimeAsync(10_000);
    await result;
    expect(calls()).toBe(1);
  });
});

describe('conversas simultâneas', () => {
  /** Resposta que só termina quando o teste manda. */
  function gated() {
    const gates: Array<() => void> = [];
    const behavior = async function* (): AsyncGenerator<LlmChunk> {
      yield { type: 'text', text: 'a' };
      await new Promise<void>((resolve) => gates.push(resolve));
      yield { type: 'end' };
    };
    return { behavior, open: () => gates.splice(0).forEach((g) => g()) };
  }

  it('a 9ª espera até 5 segundos por vaga e então recebe "alta demanda"', async () => {
    const { behavior, open } = gated();
    const { client, calls } = clientWith([behavior]);
    const llm = withResilience(client);
    const signal = new AbortController().signal;

    const running = Array.from({ length: 8 }, () => collect(llm.streamChat({ ...INPUT, signal })));
    await vi.advanceTimersByTimeAsync(0);
    expect(calls()).toBe(8);

    const ninth = collect(llm.streamChat({ ...INPUT, signal })).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(4999);
    expect(calls()).toBe(8);
    await vi.advanceTimersByTimeAsync(1);
    const error = await ninth;
    expect(error).toBeInstanceOf(LlmError);
    expect((error as LlmError).kind).toBe('busy');
    expect((error as LlmError).retryAfterMs).toBe(5000);

    open();
    await Promise.all(running);
  });

  it('quem espera pega a vaga assim que uma termina', async () => {
    const { behavior, open } = gated();
    const { client, calls } = clientWith([behavior]);
    const llm = withResilience(client);
    const signal = new AbortController().signal;

    const running = Array.from({ length: 8 }, () => collect(llm.streamChat({ ...INPUT, signal })));
    await vi.advanceTimersByTimeAsync(0);
    const ninth = collect(llm.streamChat({ ...INPUT, signal }));
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls()).toBe(8);

    open();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls()).toBe(9);
    open();
    await Promise.all([...running, ninth]);
  });
});

describe('disjuntor', () => {
  it('abre com mais de 50% de falhas na janela e falha na hora por 30 segundos', async () => {
    const { client, calls } = clientWith([fail(new LlmError('unavailable', { retryable: false }))]);
    const llm = withResilience(client);
    const signal = new AbortController().signal;

    for (let i = 0; i < 10; i++) {
      await collect(llm.streamChat({ ...INPUT, signal })).catch(() => undefined);
    }
    expect(calls()).toBe(10);

    // Aberto: nem chega a chamar o provedor.
    const error = await collect(llm.streamChat({ ...INPUT, signal })).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LlmError);
    expect(calls()).toBe(10);

    // Passados 30 segundos, volta a tentar.
    await vi.advanceTimersByTimeAsync(30_000);
    await collect(llm.streamChat({ ...INPUT, signal })).catch(() => undefined);
    expect(calls()).toBe(11);
  });

  it('não abre com poucas chamadas nem com maioria de sucessos', async () => {
    const behaviors = [
      ...Array.from({ length: 8 }, () => ok('x')),
      ...Array.from({ length: 4 }, () => fail(new LlmError('unavailable', { retryable: false }))),
    ];
    const { client, calls } = clientWith(behaviors);
    const llm = withResilience(client);
    const signal = new AbortController().signal;
    for (let i = 0; i < 12; i++) {
      await collect(llm.streamChat({ ...INPUT, signal })).catch(() => undefined);
    }
    expect(calls()).toBe(12);
  });

  it('cancelamento do cliente não conta como falha do provedor', async () => {
    const controller = new AbortController();
    const aborting = async function* (): AsyncGenerator<LlmChunk> {
      yield { type: 'text', text: 'a' };
      throw new LlmError('aborted', { retryable: false });
    };
    const { client, calls } = clientWith([aborting]);
    const llm = withResilience(client);
    for (let i = 0; i < 15; i++) {
      await collect(llm.streamChat({ ...INPUT, signal: controller.signal })).catch(() => undefined);
    }
    expect(calls()).toBe(15);
  });
});
