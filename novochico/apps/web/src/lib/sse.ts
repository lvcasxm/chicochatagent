import { chatEventSchemas, type ChatEvent, type ChatEventName } from '@chicochat/shared';

/**
 * Lê o stream de eventos (SSE) de uma resposta `fetch`. `EventSource` não serve: ele só faz GET,
 * e a mensagem vai em um POST. Eventos desconhecidos ou fora do contrato são ignorados.
 */
export async function* readChatEvents(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<ChatEvent, void, undefined> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    for (;;) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      let end = buffer.indexOf('\n\n');
      while (end >= 0) {
        const parsed = parseBlock(buffer.slice(0, end));
        buffer = buffer.slice(end + 2);
        if (parsed) yield parsed;
        end = buffer.indexOf('\n\n');
      }
      if (done) break;
    }
  } finally {
    reader.releaseLock();
  }
}

function parseBlock(block: string): ChatEvent | null {
  const name = /^event: (.+)$/m.exec(block)?.[1];
  const raw = /^data: (.+)$/m.exec(block)?.[1];
  if (!name || raw === undefined || !(name in chatEventSchemas)) return null;
  try {
    const schema = chatEventSchemas[name as ChatEventName];
    const data: unknown = JSON.parse(raw);
    const result = schema.safeParse(data);
    return result.success ? ({ event: name, data: result.data } as ChatEvent) : null;
  } catch {
    return null;
  }
}
