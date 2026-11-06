/** Dados do corpo do chamado (G.4). Tudo vem da sessão ou do formulário, nunca da IA, salvo a descrição. */
export interface TicketContentInput {
  requesterName: string;
  requesterEmail: string;
  sector: string;
  /** Nulo quando a pessoa declarou não ter acesso à máquina. */
  machineIp: string | null;
  category: string;
  onBehalf: boolean;
  beneficiaryName: string | null;
  beneficiaryRegistration: string | null;
  beneficiarySector: string | null;
  /** As seis seções, já validadas. */
  description: string;
  /** Link da transcrição; nulo em chamado de teste ou sem mensagens. */
  transcriptUrl: string | null;
}

/**
 * Texto do chamado no GLPI, em Markdown, no formato da seção G.4. O link para a conversa completa
 * só entra quando houver transcrição (F6).
 */
export function buildTicketContent(input: TicketContentInput): string {
  const lines = [
    '**Chamado aberto automaticamente pelo ChicoChat+**',
    '',
    `**Solicitante:** ${input.requesterName} (${input.requesterEmail})`,
    `**Setor do solicitante:** ${input.sector}`,
    `**IP da máquina:** ${input.machineIp ?? 'Não informado — usuário sem acesso à máquina'}`,
    `**Categoria:** ${input.category}`,
  ];

  if (input.onBehalf) {
    lines.push('', '### Atendimento solicitado para terceiro');
    lines.push(`**Nome do atendido:** ${input.beneficiaryName ?? ''}`);
    if (input.beneficiaryRegistration)
      lines.push(`**Matrícula:** ${input.beneficiaryRegistration}`);
    lines.push(`**Unidade/Setor:** ${input.beneficiarySector ?? ''}`);
  }

  lines.push('', '---', '', input.description.trim());
  if (input.transcriptUrl) {
    lines.push('', '---', '', `**Visualizar conversa completa:** ${input.transcriptUrl}`);
  }
  return lines.join('\n');
}
