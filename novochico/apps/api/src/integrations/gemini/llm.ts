/**
 * Contrato do modelo de linguagem usado pelo chat (SONNET_CONTEXT, H.1). O resto do sistema só
 * conhece esta interface: o Gemini, o fake de roteiro e o envoltório de resiliência a cumprem.
 * `integrations/` não importa nada de `modules/`.
 */

export interface LlmMessage {
  /** Só `user` e `assistant` chegam ao modelo; mensagens `notice` do sistema ficam de fora. */
  role: 'user' | 'assistant';
  content: string;
}

export type LlmChunk =
  | { type: 'text'; text: string }
  /** Último pedaço: motivo do fim e consumo, quando o provedor informa. */
  | { type: 'end'; finishReason?: string; promptTokens?: number; completionTokens?: number };

export interface LlmClient {
  streamChat(input: {
    system: string;
    messages: LlmMessage[];
    signal: AbortSignal;
  }): AsyncIterable<LlmChunk>;
}

export type LlmErrorKind =
  /** Limite de uso do provedor (HTTP 429). */
  | 'rate_limited'
  /** Provedor fora do ar, erro de rede ou resposta inesperada. */
  | 'unavailable'
  /** Sem primeiro trecho dentro do prazo. */
  | 'timeout'
  /** Fila cheia: muitas conversas ao mesmo tempo. */
  | 'busy'
  /** O cliente cancelou a requisição. */
  | 'aborted';

/**
 * Falha ao falar com a IA. A mensagem nunca vai ao usuário: o serviço do chat traduz o `kind`
 * em um texto seguro, sem nome de provedor nem detalhe técnico.
 */
export class LlmError extends Error {
  readonly kind: LlmErrorKind;
  /** Pode valer a pena tentar de novo (só antes de qualquer texto ter sido enviado). */
  readonly retryable: boolean;
  readonly retryAfterMs: number | undefined;

  constructor(
    kind: LlmErrorKind,
    options: { cause?: unknown; retryAfterMs?: number; retryable?: boolean } = {},
  ) {
    super(
      `Falha na IA: ${kind}`,
      options.cause === undefined ? undefined : { cause: options.cause },
    );
    this.name = 'LlmError';
    this.kind = kind;
    this.retryAfterMs = options.retryAfterMs;
    this.retryable =
      options.retryable ??
      (kind === 'rate_limited' || kind === 'unavailable' || kind === 'timeout');
  }
}

/** Parâmetros de geração do chat (H.2). */
export const CHAT_GENERATION = {
  temperature: 0.2,
  topP: 0.9,
  maxOutputTokens: 512,
} as const;
