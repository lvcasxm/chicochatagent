import type { RehearsalEvent } from '@chicochat/shared';
import {
  LlmError,
  type LlmChunk,
  type LlmClient,
  type LlmMessage,
} from '../../integrations/gemini/llm';
import { AppError } from '../../lib/errors';
import type { Logger } from '../../lib/logger';
import { buildSystemPrompt } from './prompt/build';
import { createMarkerFilter } from './stream-filter';

export interface Rehearsal {
  events: AsyncGenerator<RehearsalEvent, void, undefined>;
}

/**
 * Ensaio das instruções (H.10, RF-088): um chat em memória com o rascunho no lugar das instruções
 * publicadas. Nada é gravado: nem conversa, nem evento, nem cache, e nenhum chamado é aberto. Os
 * marcadores técnicos não chegam ao texto; viram eventos `marker`, para a tela avisar o que o agente
 * teria feito. O histórico vem do cliente porque não existe conversa: ele só vale para este ensaio.
 */
export function createRehearsal(deps: { llm: LlmClient | null; logger: Logger }) {
  return {
    async start(input: {
      instructions: string;
      messages: LlmMessage[];
      signal: AbortSignal;
    }): Promise<Rehearsal> {
      if (!deps.llm) {
        throw new AppError('AI_UNAVAILABLE', 503, 'A IA não está disponível para o ensaio.');
      }
      // Administrador e servidor comum veem o mesmo comportamento; o ensaio testa o do servidor.
      const prompt = buildSystemPrompt({ instructions: input.instructions, isAdmin: false });
      const stream = deps.llm.streamChat({
        system: prompt.text,
        messages: input.messages,
        signal: input.signal,
      });
      const source = stream[Symbol.asyncIterator]();

      let first: IteratorResult<LlmChunk>;
      try {
        first = await source.next();
      } catch (error) {
        deps.logger.warn({ err: error }, 'Falha ao iniciar o ensaio');
        const kind = error instanceof LlmError ? error.kind : 'unavailable';
        if (kind === 'rate_limited') {
          throw new AppError(
            'RATE_LIMITED',
            429,
            'Muitas solicitações. Tente em alguns instantes.',
          );
        }
        throw new AppError('AI_UNAVAILABLE', 503, 'Serviço de IA indisponível no momento.');
      }

      async function* events(): AsyncGenerator<RehearsalEvent, void, undefined> {
        const filter = createMarkerFilter();
        try {
          let current = first;
          while (!current.done) {
            if (current.value.type === 'text') {
              const safe = filter.push(current.value.text);
              if (safe) yield { event: 'delta', data: { text: safe } };
            }
            current = await source.next();
          }
          const { rest, markers } = filter.finish();
          if (rest) yield { event: 'delta', data: { text: rest } };
          if (markers.resolutionAttempt) {
            yield { event: 'marker', data: { kind: 'resolution_attempt' } };
          }
          if (markers.openTicketForm) yield { event: 'marker', data: { kind: 'open_ticket_form' } };
          yield { event: 'done', data: {} };
        } catch (error) {
          if (input.signal.aborted) return;
          deps.logger.warn({ err: error }, 'Ensaio interrompido');
          yield {
            event: 'error',
            data: { code: 'AI_INTERRUPTED', message: 'A resposta foi interrompida.' },
          };
        }
      }
      return { events: events() };
    },
  };
}

export type RehearsalService = ReturnType<typeof createRehearsal>;
