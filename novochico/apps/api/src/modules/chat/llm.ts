import type { AiConfig } from '../../config';
import { createGeminiClient } from '../../integrations/gemini/client';
import { createDevLlm } from '../../integrations/gemini/fake';
import type { LlmClient } from '../../integrations/gemini/llm';
import { withResilience } from './resilience';

/**
 * Escolhe a IA pela configuração. Sem chave do Gemini devolve nulo: o chat sobe, mas responde que
 * a IA está indisponível (e oferece o portal do GLPI) em vez de falhar na partida.
 */
export function createLlmFromConfig(ai: AiConfig): {
  llm: LlmClient | null;
  /** IA do resumo do chamado, com modelo próprio; sem fila, pois o resumo tem as próprias tentativas. */
  summaryLlm: LlmClient | null;
  modelName: string | null;
} {
  if (ai.provider === 'fake') {
    const dev = createDevLlm();
    return { llm: dev, summaryLlm: dev, modelName: 'fake' };
  }
  if (!ai.apiKey) return { llm: null, summaryLlm: null, modelName: null };
  return {
    llm: withResilience(createGeminiClient({ apiKey: ai.apiKey, model: ai.chatModel })),
    summaryLlm: createGeminiClient({ apiKey: ai.apiKey, model: ai.summaryModel }),
    modelName: ai.chatModel,
  };
}
