import { z } from 'zod';

/** Rótulos dos status do GLPI (RF-052). Os ids 2 e 3 são "em atendimento" (planejado ou atribuído). */
export const TICKET_STATUS_LABELS: Readonly<Record<number, string>> = {
  1: 'Novo',
  2: 'Em atendimento',
  3: 'Em atendimento',
  4: 'Pendente',
  5: 'Solucionado',
  6: 'Fechado',
};

export const URGENCY_LABELS: Readonly<Record<number, string>> = {
  1: 'Muito baixa',
  2: 'Baixa',
  3: 'Média',
  4: 'Alta',
  5: 'Muito alta',
};

export const myTicketSchema = z.object({
  /** Número do chamado (protocolo). */
  id: z.string(),
  title: z.string(),
  /** Nulo quando o GLPI não respondeu e só há o registro local. */
  statusLabel: z.string().nullable(),
  createdAt: z.iso.datetime().nullable(),
  updatedAt: z.iso.datetime().nullable(),
  urgencyLabel: z.string().nullable(),
  /** Texto plano: nunca HTML nem markdown vindos do GLPI (S-06). */
  description: z.string().nullable(),
});
export type MyTicket = z.infer<typeof myTicketSchema>;

/**
 * Por que a lista pode estar incompleta: o usuário não tem cadastro no GLPI, ou o GLPI não
 * respondeu. Nos dois casos a lista traz o que o sistema registrou localmente (RF-053).
 */
export const MY_TICKETS_NOTICES = ['requester_not_found', 'glpi_unavailable'] as const;

export const myTicketsResponseSchema = z.object({
  tickets: z.array(myTicketSchema),
  notice: z.enum(MY_TICKETS_NOTICES).nullable(),
});
export type MyTicketsResponse = z.infer<typeof myTicketsResponseSchema>;

export const transcriptResponseSchema = z.object({
  ticketId: z.string().nullable(),
  title: z.string().nullable(),
  summary: z.string().nullable(),
  requesterName: z.string().nullable(),
  sector: z.string().nullable(),
  openedAt: z.iso.datetime(),
  messages: z.array(
    z.object({
      role: z.enum(['user', 'assistant']),
      content: z.string(),
      at: z.iso.datetime(),
    }),
  ),
});
export type TranscriptResponse = z.infer<typeof transcriptResponseSchema>;
