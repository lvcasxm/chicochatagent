import { ApiError, GoogleGenAI, type GenerateContentParameters } from '@google/genai';
import { CHAT_GENERATION, LlmError, type LlmChunk, type LlmClient } from './llm';

/** O que o cliente usa do SDK, para os testes trocarem por um duplo sem rede. */
export interface GeminiSdk {
  models: {
    generateContentStream(params: GenerateContentParameters): Promise<
      AsyncIterable<{
        text?: string;
        usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
        candidates?: Array<{ finishReason?: string }>;
      }>
    >;
  };
}

export interface GeminiClientOptions {
  apiKey: string;
  model: string;
  /** Só para testes. */
  sdk?: GeminiSdk;
}

/** Traduz a falha do SDK em um erro nosso, sem repassar texto do provedor. */
export function toLlmError(error: unknown, signal: AbortSignal): LlmError {
  if (error instanceof LlmError) return error;
  if (signal.aborted) return new LlmError('aborted', { cause: error, retryable: false });
  if (error instanceof ApiError) {
    if (error.status === 429) return new LlmError('rate_limited', { cause: error });
    // 4xx (chave inválida, modelo inexistente, pedido recusado) não melhora tentando de novo.
    const clientError = error.status >= 400 && error.status < 500;
    return new LlmError('unavailable', { cause: error, retryable: !clientError });
  }
  // Falha de rede e afins.
  return new LlmError('unavailable', { cause: error });
}

/** Cliente do Gemini via `@google/genai`. O papel `assistant` vira `model` (H.1). */
export function createGeminiClient(options: GeminiClientOptions): LlmClient {
  const sdk: GeminiSdk = options.sdk ?? new GoogleGenAI({ apiKey: options.apiKey });

  return {
    async *streamChat({ system, messages, signal }): AsyncGenerator<LlmChunk> {
      let promptTokens: number | undefined;
      let completionTokens: number | undefined;
      let finishReason: string | undefined;

      try {
        const stream = await sdk.models.generateContentStream({
          model: options.model,
          contents: messages.map((message) => ({
            role: message.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: message.content }],
          })),
          config: {
            systemInstruction: system,
            abortSignal: signal,
            ...CHAT_GENERATION,
          },
        });

        for await (const chunk of stream) {
          promptTokens = chunk.usageMetadata?.promptTokenCount ?? promptTokens;
          completionTokens = chunk.usageMetadata?.candidatesTokenCount ?? completionTokens;
          finishReason = chunk.candidates?.[0]?.finishReason ?? finishReason;
          if (chunk.text) yield { type: 'text', text: chunk.text };
        }
      } catch (error) {
        throw toLlmError(error, signal);
      }

      yield { type: 'end', finishReason, promptTokens, completionTokens };
    },
  };
}
