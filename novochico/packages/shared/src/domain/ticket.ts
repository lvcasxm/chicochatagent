export const TICKET_STATUSES = ['pending', 'success', 'failed', 'unknown'] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

/** Como o resumo do chamado foi produzido: IA, contingência sem IA ou modo de teste. */
export const SUMMARY_SOURCES = ['llm', 'fallback', 'test'] as const;
export type SummarySource = (typeof SUMMARY_SOURCES)[number];

export const URGENCY_MIN = 1;
export const URGENCY_MAX = 5;
export const DEFAULT_URGENCY = 3;

/** O GLPI recebe o título com até 80 caracteres (B-06). */
export const TICKET_TITLE_MAX_LENGTH = 80;

export const DEFAULT_TICKET_CATEGORY = 'Suporte técnico geral';
/** Só existe em chamados de teste, abertos por `admin`. */
export const TEST_TICKET_CATEGORY = 'Teste';

/**
 * Categorias válidas em um chamado (RN-22): os dez cards visíveis do Anexo C mais a categoria
 * geral. Fora desta lista, a categoria cai em `DEFAULT_TICKET_CATEGORY`.
 */
export const TICKET_CATEGORIES = [
  'Computador e Equipamentos',
  'Rede e internet',
  'E-mail e comunicação',
  'Segurança da informação',
  'Instalação de Programas',
  'Sistemas GRP Sonner',
  'Dúvidas referentes ao SEI',
  'Manutenção de Impressora',
  'Acessos e Senhas',
  'Outra coisa?',
  DEFAULT_TICKET_CATEGORY,
] as const;
export type TicketCategory = (typeof TICKET_CATEGORIES)[number];
