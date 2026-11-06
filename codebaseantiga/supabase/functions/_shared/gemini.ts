// Camada única de acesso ao Google Gemini via endpoint OpenAI-compatível.
// Toda chamada de LLM do projeto passa por aqui.
//
// Endpoint: https://generativelanguage.googleapis.com/v1beta/openai/chat/completions
// Auth: Authorization: Bearer <GEMINI_API_KEY>
// Formato: idêntico ao OpenAI/Groq → streaming SSE `data: {...}\n\n` + `data: [DONE]`.

export const GEMINI_MODEL = "gemini-3.1-flash-lite";
export const GEMINI_CHAT_URL =
  "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";

export type ChatMsg = {
  role: "system" | "user" | "assistant";
  content: string;
};

export interface GenerateChatOptions {
  model?: string;
  temperature?: number;
  top_p?: number;
  // Gemini OpenAI-compat aceita a maior parte dos campos OpenAI; top_k é ignorado.
  max_tokens?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  response_format?: { type: "json_object" | "text" };
  stream?: boolean;
  stream_options?: { include_usage?: boolean };
}

/** Chama o modelo Gemini. Retorna a `Response` HTTP crua para preservar SSE streaming. */
export async function generateChatResponse(
  messages: ChatMsg[],
  options: GenerateChatOptions = {},
  init: { apiKey: string; signal?: AbortSignal },
): Promise<Response> {
  const {
    model = GEMINI_MODEL,
    temperature = 0.2,
    top_p = 0.9,
    max_tokens = 512,
    frequency_penalty = 0,
    presence_penalty = 0,
    response_format,
    stream = false,
    stream_options,
  } = options;

  // Gemini's OpenAI-compat endpoint NÃO aceita frequency_penalty / presence_penalty.
  // Mantemos os parâmetros na assinatura por compatibilidade, mas não enviamos ao Gemini.
  void frequency_penalty;
  void presence_penalty;
  const body: Record<string, unknown> = {
    model,
    messages,
    temperature,
    top_p,
    max_tokens,
    stream,
  };
  if (response_format) body.response_format = response_format;
  if (stream && stream_options) body.stream_options = stream_options;

  return fetch(GEMINI_CHAT_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${init.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: init.signal,
  });
}
