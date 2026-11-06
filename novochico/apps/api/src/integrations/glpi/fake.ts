import { GlpiError, type GlpiClient, type GlpiTicketInput } from './glpi';

/**
 * GLPI de mentira, sem rede. Serve aos testes e ao desenvolvimento (`GLPI_PROVIDER=fake`): guarda
 * os chamados "abertos" em memória e deixa o teste escolher como cada operação responde.
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
}

export interface FakeGlpiTicket extends GlpiTicketInput {
  ticketId: string;
  requesterId: number | null;
}

export function createFakeGlpi(options: FakeGlpiOptions = {}) {
  let nextId = options.firstTicketId ?? 1000;
  const tickets: FakeGlpiTicket[] = [];
  const lookups: string[] = [];
  const attached: Array<{ ticketId: string; requesterId: number }> = [];
  let creates = 0;

  const client: GlpiClient = {
    findRequesterId(email) {
      lookups.push(email);
      if (options.requester === 'error') return Promise.reject(new GlpiError('GLPI_UNAVAILABLE'));
      return Promise.resolve(options.requester === 'missing' ? null : 7);
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
  };

  return { client, tickets, lookups, attached, creates: () => creates };
}

/** GLPI de desenvolvimento: sempre abre o chamado, com números a partir de 1000. */
export function createDevGlpi(): GlpiClient {
  return createFakeGlpi().client;
}
