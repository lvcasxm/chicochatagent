import {
  DEFAULT_TICKET_CATEGORY,
  DEFAULT_URGENCY,
  TEST_TICKET_CATEGORY,
  TICKET_TITLE_MAX_LENGTH,
} from '@chicochat/shared';
import type { TicketSummary, TranscriptLine } from './summary';

const MAX_PROBLEM_LENGTH = 2500;
const MAX_OTHER_STATEMENTS_LENGTH = 1500;
const NO_DETAILS =
  'Os detalhes do problema não puderam ser consolidados automaticamente no momento da abertura.';

/** Só uma saudação, sem o que a pessoa precisa. */
const GREETING_ONLY = /^(oi|olá|ola|bom dia|boa tarde|boa noite|e aí|e ai)[\s!.,?]*$/i;
/** Mensagem pronta dos cards ("Olá! Tenho uma demanda de TI…" e as demais). */
const CANNED_START = /^olá!\s+(estou|preciso|tenho)\b/i;

/** As falas da pessoa que dizem algo: sem saudação sozinha e sem mensagem pronta de card. */
function significantUserMessages(
  transcript: readonly TranscriptLine[],
  cannedMessages: readonly string[],
): string[] {
  return transcript
    .filter((line) => line.role === 'user')
    .map((line) => line.content.trim())
    .filter(
      (text) =>
        text !== '' &&
        !GREETING_ONLY.test(text) &&
        !cannedMessages.includes(text) &&
        !CANNED_START.test(text),
    );
}

/** A maior fala significativa da pessoa. */
export function mostSignificantUserMessage(
  transcript: readonly TranscriptLine[],
  cannedMessages: readonly string[],
): string | null {
  const candidates = significantUserMessages(transcript, cannedMessages);
  if (candidates.length === 0) return null;
  const longest = candidates.reduce((a, b) => (b.length > a.length ? b : a));
  return longest.length > MAX_PROBLEM_LENGTH ? longest.slice(0, MAX_PROBLEM_LENGTH) : longest;
}

/**
 * Contingência sem IA (Anexo B): o que a pessoa escreveu de mais significativo, o setor e
 * avisos de que o resto não foi consolidado. Nunca inclui a transcrição (G.5).
 */
export function buildFallbackSummary(input: {
  sector: string;
  cardCategory: string | null;
  transcript: readonly TranscriptLine[];
  cannedMessages: readonly string[];
}): TicketSummary {
  const problem = mostSignificantUserMessage(input.transcript, input.cannedMessages) ?? NO_DETAILS;
  // As demais falas seguem junto: um dado curto, como o módulo do Sonner, não pode se perder.
  const others = significantUserMessages(input.transcript, input.cannedMessages)
    .filter((text) => text.slice(0, MAX_PROBLEM_LENGTH) !== problem)
    .map((text) => `- ${text}`)
    .join('\n')
    .slice(0, MAX_OTHER_STATEMENTS_LENGTH);
  const otherStatements = others === '' ? '' : `\n${others}`;
  const description = [
    `Problema identificado:\n${problem}`,
    'Contexto:\nEscopo não confirmado pelo usuário.',
    `Comportamento observado:\nDetalhes adicionais não puderam ser consolidados automaticamente no momento da abertura.${otherStatements}`,
    'Tentativas já realizadas:\nNão foi possível consolidar automaticamente as tentativas realizadas.',
    'Impacto operacional:\nImpacto não detalhado pelo usuário; assumir impacto sobre as atividades do setor informado.',
    'Ação esperada:\nRealizar diagnóstico técnico com base no problema informado e consultar a conversa completa vinculada ao chamado se forem necessários detalhes adicionais.',
  ].join('\n\n');

  return {
    title: `Solicitação de suporte — ${input.sector}`.slice(0, TICKET_TITLE_MAX_LENGTH),
    description,
    category: input.cardCategory ?? DEFAULT_TICKET_CATEGORY,
    urgency: DEFAULT_URGENCY,
    source: 'fallback',
  };
}

/** Chamado de teste do administrador: sem IA, para ser fechado sem ação (Anexo B). */
export function buildTestSummary(input: { sector: string; date: string }): TicketSummary {
  return {
    title: 'Chamado de teste',
    description: `Este é um chamado de teste aberto pelo ChicoChat+ em ${input.date} pelo setor ${input.sector}.\n\nNenhuma ação é necessária — o chamado pode ser fechado.`,
    category: TEST_TICKET_CATEGORY,
    urgency: 1,
    source: 'test',
  };
}
