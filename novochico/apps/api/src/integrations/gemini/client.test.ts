import { ApiError } from '@google/genai';
import { describe, expect, it } from 'vitest';
import { createGeminiClient, toLlmError, type GeminiSdk } from './client';
import { createDevLlm, createScriptedLlm } from './fake';
import { CHAT_GENERATION, LlmError, type LlmChunk } from './llm';

function sdkWith(
  chunks: Array<{ text?: string; usage?: [number, number]; finish?: string }>,
  options: { failAt?: unknown; jsonText?: string } = {},
) {
  const requests: unknown[] = [];
  const sdk: GeminiSdk = {
    models: {
      generateContent(params) {
        requests.push(params);
        if (options.failAt !== undefined) return Promise.reject(options.failAt);
        return Promise.resolve({ text: options.jsonText });
      },
      generateContentStream(params) {
        requests.push(params);
        if (options.failAt !== undefined && chunks.length === 0)
          return Promise.reject(options.failAt);
        async function* stream() {
          for (const chunk of chunks) {
            yield {
              text: chunk.text,
              usageMetadata: chunk.usage
                ? { promptTokenCount: chunk.usage[0], candidatesTokenCount: chunk.usage[1] }
                : undefined,
              candidates: chunk.finish ? [{ finishReason: chunk.finish }] : undefined,
            };
          }
          if (options.failAt !== undefined) throw options.failAt;
        }
        return Promise.resolve(stream());
      },
    },
  };
  return { sdk, requests };
}

async function collect(stream: AsyncIterable<LlmChunk>) {
  const chunks: LlmChunk[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return chunks;
}

const MESSAGES = [
  { role: 'user' as const, content: 'Meu PC não liga' },
  { role: 'assistant' as const, content: 'Qual o equipamento?' },
  { role: 'user' as const, content: 'Um notebook' },
];

describe('createGeminiClient', () => {
  it('manda o prompt como instrução de sistema e traduz assistant para model', async () => {
    const { sdk, requests } = sdkWith([{ text: 'Oi' }]);
    const client = createGeminiClient({ apiKey: 'chave-de-teste', model: 'modelo-x', sdk });
    await collect(
      client.streamChat({
        system: 'REGRAS',
        messages: MESSAGES,
        signal: new AbortController().signal,
      }),
    );

    const request = requests[0] as {
      model: string;
      contents: Array<{ role: string; parts: Array<{ text: string }> }>;
      config: Record<string, unknown>;
    };
    expect(request.model).toBe('modelo-x');
    expect(request.contents.map((c) => c.role)).toEqual(['user', 'model', 'user']);
    expect(request.contents[0]?.parts[0]?.text).toBe('Meu PC não liga');
    expect(request.config.systemInstruction).toBe('REGRAS');
    // O prompt do sistema nunca é misturado às mensagens do usuário.
    expect(JSON.stringify(request.contents)).not.toContain('REGRAS');
  });

  it('usa os parâmetros do chat: temperatura 0,2, top_p 0,9 e 512 tokens', async () => {
    const { sdk, requests } = sdkWith([{ text: 'Oi' }]);
    const client = createGeminiClient({ apiKey: 'k', model: 'm', sdk });
    await collect(
      client.streamChat({ system: 's', messages: MESSAGES, signal: new AbortController().signal }),
    );
    const config = (requests[0] as { config: Record<string, unknown> }).config;
    expect(config).toMatchObject({ temperature: 0.2, topP: 0.9, maxOutputTokens: 512 });
    expect(CHAT_GENERATION).toEqual({ temperature: 0.2, topP: 0.9, maxOutputTokens: 512 });
  });

  it('repassa o sinal de cancelamento ao SDK', async () => {
    const controller = new AbortController();
    const { sdk, requests } = sdkWith([{ text: 'x' }]);
    const client = createGeminiClient({ apiKey: 'k', model: 'm', sdk });
    await collect(
      client.streamChat({ system: 's', messages: MESSAGES, signal: controller.signal }),
    );
    expect((requests[0] as { config: { abortSignal: AbortSignal } }).config.abortSignal).toBe(
      controller.signal,
    );
  });

  it('entrega o texto em trechos e fecha com o motivo e o consumo', async () => {
    const { sdk } = sdkWith([
      { text: 'Qual ' },
      { text: 'o equipamento?', usage: [120, 6], finish: 'STOP' },
    ]);
    const client = createGeminiClient({ apiKey: 'k', model: 'm', sdk });
    const chunks = await collect(
      client.streamChat({ system: 's', messages: MESSAGES, signal: new AbortController().signal }),
    );
    expect(chunks).toEqual([
      { type: 'text', text: 'Qual ' },
      { type: 'text', text: 'o equipamento?' },
      { type: 'end', finishReason: 'STOP', promptTokens: 120, completionTokens: 6 },
    ]);
  });

  it('ignora trechos sem texto (só metadados)', async () => {
    const { sdk } = sdkWith([{ usage: [5, 0] }, { text: 'Ok', finish: 'STOP' }]);
    const client = createGeminiClient({ apiKey: 'k', model: 'm', sdk });
    const chunks = await collect(
      client.streamChat({ system: 's', messages: MESSAGES, signal: new AbortController().signal }),
    );
    expect(chunks.filter((c) => c.type === 'text')).toHaveLength(1);
  });

  it('falha ao abrir o stream vira erro nosso, sem texto do provedor', async () => {
    const { sdk } = sdkWith([], {
      failAt: new ApiError({ message: 'quota exceeded for project abc-123', status: 429 }),
    });
    const client = createGeminiClient({ apiKey: 'k', model: 'm', sdk });
    const error = await collect(
      client.streamChat({ system: 's', messages: MESSAGES, signal: new AbortController().signal }),
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LlmError);
    expect((error as LlmError).kind).toBe('rate_limited');
    expect((error as LlmError).message).not.toContain('abc-123');
  });

  it('falha no meio do stream também vira erro nosso', async () => {
    const { sdk } = sdkWith([{ text: 'Parcial' }], {
      failAt: new ApiError({ message: 'unavailable', status: 503 }),
    });
    const client = createGeminiClient({ apiKey: 'k', model: 'm', sdk });
    const received: LlmChunk[] = [];
    const error = await (async () => {
      try {
        for await (const chunk of client.streamChat({
          system: 's',
          messages: MESSAGES,
          signal: new AbortController().signal,
        })) {
          received.push(chunk);
        }
      } catch (e) {
        return e;
      }
      return null;
    })();
    expect(received).toEqual([{ type: 'text', text: 'Parcial' }]);
    expect((error as LlmError).kind).toBe('unavailable');
  });
});

describe('toLlmError', () => {
  const live = new AbortController().signal;

  it.each([
    [429, 'rate_limited', true],
    [500, 'unavailable', true],
    [503, 'unavailable', true],
    [400, 'unavailable', false],
    [401, 'unavailable', false],
    [403, 'unavailable', false],
    [404, 'unavailable', false],
  ])('HTTP %i vira %s (repetir: %s)', (status, kind, retryable) => {
    const error = toLlmError(new ApiError({ message: 'x', status }), live);
    expect(error.kind).toBe(kind);
    expect(error.retryable).toBe(retryable);
  });

  it('erro de rede é indisponível e vale repetir', () => {
    const error = toLlmError(new TypeError('fetch failed'), live);
    expect(error.kind).toBe('unavailable');
    expect(error.retryable).toBe(true);
  });

  it('com o cliente desconectado, é cancelamento e não se repete', () => {
    const controller = new AbortController();
    controller.abort();
    const error = toLlmError(new Error('aborted'), controller.signal);
    expect(error.kind).toBe('aborted');
    expect(error.retryable).toBe(false);
  });
});

describe('duplos de desenvolvimento e teste', () => {
  it('o roteiro devolve uma resposta por chamada e guarda as chamadas', async () => {
    const { client, calls, remaining } = createScriptedLlm([['A', 'B'], ['C']]);
    const signal = new AbortController().signal;
    expect(
      await collect(client.streamChat({ system: 's1', messages: MESSAGES, signal })),
    ).toHaveLength(3);
    await collect(client.streamChat({ system: 's2', messages: MESSAGES, signal }));
    expect(calls.map((c) => c.system)).toEqual(['s1', 's2']);
    expect(remaining()).toBe(0);
  });

  it('a IA de desenvolvimento segue uma triagem típica e parte o marcador em trechos', async () => {
    const llm = createDevLlm({ chunkDelayMs: 0 });
    const signal = new AbortController().signal;
    const text = async (messages: typeof MESSAGES) =>
      (await collect(llm.streamChat({ system: 's', messages, signal })))
        .map((c) => (c.type === 'text' ? c.text : ''))
        .join('');

    expect(await text([{ role: 'user', content: 'meu pc não liga' }])).toContain(
      'qual equipamento',
    );
    const second = await text(MESSAGES.slice(0, 3));
    expect(second).toContain('<<RESOLUTION_ATTEMPT>>');
    const escalation = await text([
      { role: 'user', content: 'a' },
      { role: 'assistant', content: 'b' },
      { role: 'user', content: 'c' },
      { role: 'assistant', content: 'd' },
      { role: 'user', content: 'não resolveu' },
    ]);
    expect(escalation).toContain('<<OPEN_TICKET_FORM>>');
  });
});

describe('generateJson', () => {
  const signal = new AbortController().signal;

  it('pede JSON, com o prompt como instrução de sistema, e devolve o objeto lido', async () => {
    const { sdk, requests } = sdkWith([], { jsonText: '{"titulo":"x","urgencia":3}' });
    const client = createGeminiClient({ apiKey: 'k', model: 'modelo-resumo', sdk });
    const result = await client.generateJson({ system: 'REGRAS', user: 'Conversa', signal });
    expect(result).toEqual({ titulo: 'x', urgencia: 3 });

    const request = requests[0] as {
      model: string;
      contents: Array<{ role: string; parts: Array<{ text: string }> }>;
      config: Record<string, unknown>;
    };
    expect(request.model).toBe('modelo-resumo');
    expect(request.config.responseMimeType).toBe('application/json');
    expect(request.config.systemInstruction).toBe('REGRAS');
    expect(request.contents).toEqual([{ role: 'user', parts: [{ text: 'Conversa' }] }]);
  });

  it('resposta que não é JSON vira falha nossa, para tentar de novo', async () => {
    const { sdk } = sdkWith([], { jsonText: 'Claro! Aqui está o chamado...' });
    const client = createGeminiClient({ apiKey: 'k', model: 'm', sdk });
    const error = await client
      .generateJson({ system: 's', user: 'u', signal })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LlmError);
    expect((error as LlmError).kind).toBe('unavailable');
  });

  it('limite e queda do provedor viram erro nosso, sem texto do provedor', async () => {
    const { sdk } = sdkWith([], { failAt: new ApiError({ message: 'cota abc-9', status: 429 }) });
    const client = createGeminiClient({ apiKey: 'k', model: 'm', sdk });
    const error = await client
      .generateJson({ system: 's', user: 'u', signal })
      .catch((e: unknown) => e);
    expect((error as LlmError).kind).toBe('rate_limited');
    expect((error as LlmError).message).not.toContain('abc-9');
  });
});
