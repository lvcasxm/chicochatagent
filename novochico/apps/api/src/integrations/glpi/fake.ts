import { GlpiError, type GlpiClient, type GlpiTicket, type GlpiTicketInput } from './glpi';

/**
 * GLPI de mentira, sem rede. Serve aos testes e ao desenvolvimento (`GLPI_PROVIDER=fake`): guarda
 * os chamados "abertos" em memória e deixa o teste escolher como cada operação responde. Cada
 * e-mail recebe o seu próprio número de usuário, para os testes provarem que um usuário nunca vê
 * os chamados de outro.
 */
export interface FakeGlpiOptions {
  /** Primeiro número de chamado. */
  firstTicketId?: number;
  /** Falha de criação, ou uma função que decide a cada chamada. */
  createFails?: GlpiError | ((input: GlpiTicketInput) => GlpiError | null);
  /** `'missing'`: ninguém é encontrado. `'error'`: a busca falha. Padrão: todos têm cadastro. */
  requester?: 'found' | 'missing' | 'error';
  attachFails?: boolean;
  /** Espera antes de criar (para testar chamadas simultâneas). */
  createDelayMs?: number;
  /** Falha na leitura dos chamados (listagem e consulta individual). */
  readFails?: GlpiError;
  /** Chamados que já existiam no GLPI, abertos por outros meios (portal, telefone). */
  existing?: Array<GlpiTicket & { requesterId: number }>;
}

export interface FakeGlpiTicket extends GlpiTicketInput {
  ticketId: string;
  requesterId: number | null;
}

function withoutOwner(ticket: GlpiTicket & { requesterId: number }): GlpiTicket {
  return {
    id: ticket.id,
    title: ticket.title,
    statusId: ticket.statusId,
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt,
    urgency: ticket.urgency,
    content: ticket.content,
  };
}

export function createFakeGlpi(options: FakeGlpiOptions = {}) {
  let nextId = options.firstTicketId ?? 1000;
  let nextUserId = 7;
  const userIds = new Map<string, number>();
  const tickets: FakeGlpiTicket[] = [];
  const lookups: string[] = [];
  const attached: Array<{ ticketId: string; requesterId: number }> = [];
  const reads: string[] = [];
  let creates = 0;
  const now = () => new Date().toISOString();

  const asGlpi = (ticket: FakeGlpiTicket): GlpiTicket => ({
    id: ticket.ticketId,
    title: ticket.title,
    statusId: 1,
    createdAt: now(),
    updatedAt: now(),
    urgency: ticket.urgency,
    content: ticket.content,
  });

  const client: GlpiClient = {
    findRequesterId(email) {
      lookups.push(email);
      if (options.requester === 'error') return Promise.reject(new GlpiError('GLPI_UNAVAILABLE'));
      if (options.requester === 'missing') return Promise.resolve(null);
      let id = userIds.get(email);
      if (id === undefined) {
        id = nextUserId++;
        userIds.set(email, id);
      }
      return Promise.resolve(id);
    },

    async createTicket(input) {
      creates += 1;
      if (options.createDelayMs) await new Promise((r) => setTimeout(r, options.createDelayMs));
      const failure =
        typeof options.createFails === 'function'
          ? options.createFails(input)
          : options.createFails;
      if (failure) throw failure;
      const ticketId = String(nextId++);
      tickets.push({ ...input, ticketId, requesterId: null });
      return { ticketId };
    },

    attachRequester(ticketId, requesterId) {
      if (options.attachFails) return Promise.reject(new GlpiError('GLPI_SERVER'));
      attached.push({ ticketId, requesterId });
      const ticket = tickets.find((t) => t.ticketId === ticketId);
      if (ticket) ticket.requesterId = requesterId;
      return Promise.resolve();
    },

    listTickets(requesterId) {
      reads.push(`list:${requesterId}`);
      if (options.readFails) return Promise.reject(options.readFails);
      const mine = [
        ...tickets.filter((t) => t.requesterId === requesterId).map(asGlpi),
        ...(options.existing ?? []).filter((t) => t.requesterId === requesterId).map(withoutOwner),
      ];
      return Promise.resolve(mine);
    },

    getTicket(ticketId) {
      reads.push(`get:${ticketId}`);
      if (options.readFails) return Promise.reject(options.readFails);
      const created = tickets.find((t) => t.ticketId === ticketId);
      if (created) return Promise.resolve(asGlpi(created));
      const existing = (options.existing ?? []).find((t) => t.id === ticketId);
      if (!existing) return Promise.resolve(null);
      return Promise.resolve(withoutOwner(existing));
    },
  };

  return { client, tickets, lookups, attached, reads, creates: () => creates, userIds };
}

/** GLPI de desenvolvimento: sempre abre o chamado, com números a partir de 1000. */
export function createDevGlpi(): GlpiClient {
  return createFakeGlpi().client;
}
