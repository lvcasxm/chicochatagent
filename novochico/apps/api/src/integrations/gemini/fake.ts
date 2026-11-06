import { LlmError, type LlmChunk, type LlmClient, type LlmMessage } from './llm';

/**
 * Duplos da IA, sem rede e sem chave. Servem aos testes e ao desenvolvimento da interface
 * (`AI_PROVIDER=fake`). Não imitam a qualidade do modelo: só o formato do stream, inclusive
 * com marcadores partidos entre trechos, que é o caso difícil do filtro.
 */

export interface LlmCall {
  system: string;
  messages: LlmMessage[];
}

export type ScriptedTurn =
  /** Trechos de texto enviados em sequência. */
  | string[]
  /** Falha antes do primeiro trecho. */
  | LlmError
  /** Alguns trechos e depois uma falha no meio do stream. */
  | { chunks: string[]; thenFail: LlmError }
  /** Um trecho de cada vez, à mão do teste (para cancelamento e concorrência). */
  | ((signal: AbortSignal) => AsyncIterable<string>);

/** Responde com o roteiro, um item por chamada, e guarda as chamadas para o teste conferir. */
export function createScriptedLlm(script: ScriptedTurn[]) {
  const calls: LlmCall[] = [];
  let index = 0;

  const client: LlmClient = {
    async *streamChat({ system, messages, signal }): AsyncGenerator<LlmChunk> {
      calls.push({ system, messages: messages.map((m) => ({ ...m })) });
      const turn = script[index++];
      if (turn === undefined) throw new Error('O roteiro do fake acabou');
      if (turn instanceof LlmError) throw turn;

      if (typeof turn === 'function') {
        for await (const text of turn(signal)) yield { type: 'text', text };
      } else if (Array.isArray(turn)) {
        for (const text of turn) {
          if (signal.aborted) throw new LlmError('aborted', { retryable: false });
          yield { type: 'text', text };
        }
      } else {
        for (const text of turn.chunks) yield { type: 'text', text };
        throw turn.thenFail;
      }
      yield { type: 'end', finishReason: 'STOP', promptTokens: 10, completionTokens: 5 };
    },
  };

  return { client, calls, remaining: () => script.length - index };
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    });
  });

const PERSISTS = /(nao resolveu|não resolveu|nao funcionou|não funcionou|continua|persiste)/i;

/** Roteiro de uma triagem típica, para ver o chat funcionando sem chave. */
function devReply(messages: LlmMessage[]): string {
  const users = messages.filter((m) => m.role === 'user');
  const last = users.at(-1)?.content ?? '';
  const turn = users.length;

  if (/\bsei\b/i.test(last)) {
    return 'Dúvidas sobre o SEI são atendidas pelo **Joseias**, o assistente especializado: https://joseias.example.test';
  }
  if (turn >= 3 && PERSISTS.test(last)) {
    return 'Como não conseguimos resolver por aqui, vou abrir um chamado para o suporte técnico.\n<<OPEN_TICKET_FORM>>';
  }
  if (turn === 1) {
    return 'Para começar: qual equipamento ou sistema está com o problema?';
  }
  if (turn === 2) {
    return 'Tente este passo:\n\n1. Salve o que estiver aberto.\n2. **Reinicie** o computador.\n\nO problema continua depois disso?\n<<RESOLUTION_ATTEMPT>>';
  }
  return 'Entendi. O problema continua depois de reiniciar?';
}

/**
 * IA de desenvolvimento: respostas fixas por etapa da conversa, enviadas em trechos pequenos
 * e com um pequeno atraso, como um stream de verdade.
 */
export function createDevLlm(options: { chunkDelayMs?: number } = {}): LlmClient {
  const delay = options.chunkDelayMs ?? 20;
  return {
    async *streamChat({ messages, signal }): AsyncGenerator<LlmChunk> {
      const reply = devReply(messages);
      // Trechos de 7 caracteres partem os marcadores no meio de propósito.
      for (let i = 0; i < reply.length; i += 7) {
        await sleep(delay, signal);
        if (signal.aborted) throw new LlmError('aborted', { retryable: false });
        yield { type: 'text', text: reply.slice(i, i + 7) };
      }
      yield { type: 'end', finishReason: 'STOP' };
    },
  };
}
