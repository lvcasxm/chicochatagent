/**
 * Contrato do GLPI usado pelos chamados (SONNET_CONTEXT, seção G). O resto do sistema só conhece
 * esta interface: o cliente HTTP e o fake a cumprem. `integrations/` não importa de `modules/`.
 */

export type GlpiErrorCode =
  /** Rede fora do ar antes de enviar, ou falha ao obter o token. */
  | 'GLPI_UNAVAILABLE'
  | 'GLPI_AUTH'
  | 'GLPI_NOT_FOUND'
  | 'GLPI_SERVER'
  /** Outro 4xx: o GLPI recusou o pedido (campo inválido, por exemplo). */
  | 'GLPI_REJECTED'
  /** Sem resposta depois de enviar: o chamado pode ter sido criado. */
  | 'GLPI_TIMEOUT'
  /** 2xx sem número de chamado: o chamado pode ter sido criado. */
  | 'GLPI_BAD_RESPONSE';

/**
 * Falha ao falar com o GLPI. A mensagem nunca vai ao usuário e não deve conter dados do chamado:
 * o serviço de chamados traduz o `code` em um texto seguro (G.8).
 */
export class GlpiError extends Error {
  readonly code: GlpiErrorCode;
  /** HTTP recebido, se houve resposta. */
  readonly httpStatus: number | undefined;

  constructor(code: GlpiErrorCode, options: { httpStatus?: number; cause?: unknown } = {}) {
    super(
      options.httpStatus === undefined ? code : `${code} (HTTP ${options.httpStatus})`,
      options.cause === undefined ? undefined : { cause: options.cause },
    );
    this.name = 'GlpiError';
    this.code = code;
    this.httpStatus = options.httpStatus;
  }

  /**
   * O pedido pode ter chegado ao GLPI sem que saibamos o resultado. Nesse caso nunca se reenvia
   * sozinho: a pessoa confere em "Meus chamados" antes de tentar de novo.
   */
  get outcomeUnknown(): boolean {
    return this.code === 'GLPI_TIMEOUT' || this.code === 'GLPI_BAD_RESPONSE';
  }
}

export interface GlpiTicketInput {
  /** Até 80 caracteres (B-06). */
  title: string;
  /** Markdown no formato da seção G.4. */
  content: string;
  urgency: number;
}

export interface GlpiClient {
  /** Identificador do usuário no GLPI com este e-mail, ou nulo se não houver. */
  findRequesterId(email: string): Promise<number | null>;
  /** Cria o chamado e devolve o número. */
  createTicket(input: GlpiTicketInput): Promise<{ ticketId: string }>;
  /** Liga o solicitante ao chamado. Falhar aqui não desfaz o chamado. */
  attachRequester(ticketId: string, requesterId: number): Promise<void>;
}
