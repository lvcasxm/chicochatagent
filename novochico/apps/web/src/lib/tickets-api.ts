import {
  createTicketResponseSchema,
  ticketCheckResponseSchema,
  type CreateTicketRequest,
  type CreateTicketResponse,
  type TicketCheckResponse,
} from '@chicochat/shared';
import { call } from './api';

/** Chamados parecidos e incidente coletivo. A checagem nunca bloqueia: erro vira "nada a avisar". */
export async function checkTickets(conversationId: string): Promise<TicketCheckResponse> {
  try {
    const response = await call(
      `/api/conversations/${encodeURIComponent(conversationId)}/ticket-check`,
      {
        method: 'POST',
      },
    );
    if (!response.ok) return { similar: [], collective: null };
    return ticketCheckResponseSchema.parse(await response.json());
  } catch {
    return { similar: [], collective: null };
  }
}

/** Falha em abrir o chamado antes de haver um resultado (recusa do servidor ou rede). */
export class TicketRequestError extends Error {
  readonly status: number | null;
  readonly code: string | null;

  constructor(status: number | null, code: string | null) {
    super(`Falha ao abrir o chamado: ${status ?? 'rede'}`);
    this.name = 'TicketRequestError';
    this.status = status;
    this.code = code;
  }
}

/**
 * Abre o chamado. A mesma `idempotencyKey` nunca cria dois chamados: se a resposta se perdeu na
 * rede, repetir com a mesma chave devolve o resultado gravado.
 */
export async function createTicket(
  conversationId: string,
  body: CreateTicketRequest,
  idempotencyKey: string,
): Promise<CreateTicketResponse> {
  let response: Response;
  try {
    response = await call(`/api/conversations/${encodeURIComponent(conversationId)}/tickets`, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'idempotency-key': idempotencyKey },
    });
  } catch {
    throw new TicketRequestError(null, null);
  }
  if (!response.ok) {
    let code: string | null = null;
    try {
      code = ((await response.json()) as { error?: { code?: string } }).error?.code ?? null;
    } catch {
      // Sem corpo JSON: só o status importa.
    }
    throw new TicketRequestError(response.status, code);
  }
  return createTicketResponseSchema.parse(await response.json());
}
