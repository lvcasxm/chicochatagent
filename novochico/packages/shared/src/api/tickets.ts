import { z } from 'zod';
import { TICKET_STATUSES } from '../domain/ticket';

/** Formato do IP das máquinas da Prefeitura; o servidor pode sobrescrever (PEND-13). */
export const DEFAULT_IP_PATTERN = '^\\d{2}\\.\\d\\.\\d\\.\\d{2,3}$';

/** IP no formato esperado e com cada octeto até 255. */
export function isValidMachineIp(
  ip: string,
  pattern: RegExp = new RegExp(DEFAULT_IP_PATTERN),
): boolean {
  if (!pattern.test(ip)) return false;
  const octets = ip.split('.').map(Number);
  return octets.length === 4 && octets.every((octet) => Number.isInteger(octet) && octet <= 255);
}

const text = (min: number, max: number) => z.string().trim().min(min).max(max);

/**
 * Pedido de abertura de chamado. A identidade (nome e e-mail) vem da sessão, nunca daqui: o
 * esquema é estrito, então qualquer campo a mais é recusado (ADR-013).
 */
export const createTicketRequestSchema = z
  .strictObject({
    sector: text(2, 120),
    /** Obrigatório, salvo `ipUnavailable`. O formato é validado pelo servidor. */
    machineIp: text(1, 20).optional(),
    ipUnavailable: z.boolean().default(false),
    onBehalf: z.boolean().default(false),
    beneficiaryName: text(1, 120).optional(),
    beneficiaryRegistration: text(1, 40).optional(),
    beneficiarySector: text(1, 120).optional(),
    /** Chamado de teste: só o administrador. */
    testMode: z.boolean().default(false),
    /** A pessoa viu o aviso de chamados parecidos e escolheu "Abrir mesmo assim". */
    duplicateOverride: z.boolean().default(false),
  })
  .superRefine((value, ctx) => {
    const hasIp = value.machineIp !== undefined;
    if (hasIp === value.ipUnavailable) {
      ctx.addIssue({ code: 'custom', path: ['machineIp'], message: 'IP ou "sem acesso"' });
    }
    if (value.onBehalf && (!value.beneficiaryName || !value.beneficiarySector)) {
      ctx.addIssue({ code: 'custom', path: ['beneficiaryName'], message: 'atendido' });
    }
  });
export type CreateTicketRequest = z.infer<typeof createTicketRequestSchema>;

export const createTicketResponseSchema = z.object({
  status: z.enum(
    TICKET_STATUSES.filter((s) => s !== 'pending') as ['success', 'failed', 'unknown'],
  ),
  /** Número do chamado (protocolo) quando aberto. */
  ticketId: z.string().nullable(),
  title: z.string().nullable(),
  /** Texto para a pessoa, sempre seguro (sem detalhe técnico). */
  message: z.string(),
});
export type CreateTicketResponse = z.infer<typeof createTicketResponseSchema>;

export const ticketCheckResponseSchema = z.object({
  /** Até 3 chamados parecidos do próprio usuário. */
  similar: z.array(
    z.object({
      ticketId: z.string(),
      title: z.string(),
      category: z.string().nullable(),
      ageMinutes: z.number().int().nonnegative(),
    }),
  ),
  /** Relatos semelhantes de outras pessoas: só a contagem, nunca o conteúdo. */
  collective: z
    .object({ count: z.number().int(), category: z.string().nullable(), windowHours: z.number() })
    .nullable(),
});
export type TicketCheckResponse = z.infer<typeof ticketCheckResponseSchema>;
