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
  modelName: string | null;
} {
  if (ai.provider === 'fake') return { llm: createDevLlm(), modelName: 'fake' };
  if (!ai.apiKey) return { llm: null, modelName: null };
  return {
    llm: withResilience(createGeminiClient({ apiKey: ai.apiKey, model: ai.chatModel })),
    modelName: ai.chatModel,
  };
}
