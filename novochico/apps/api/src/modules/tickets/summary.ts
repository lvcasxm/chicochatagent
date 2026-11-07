import { z } from 'zod';
import {
  DEFAULT_TICKET_CATEGORY,
  DEFAULT_URGENCY,
  TICKET_CATEGORIES,
  TICKET_TITLE_MAX_LENGTH,
  URGENCY_MAX,
  URGENCY_MIN,
} from '@chicochat/shared';
import { LlmError, type LlmClient } from '../../integrations/gemini/llm';
import { SUMMARY_SYSTEM_PROMPT } from './summary-prompt';

/** As seis seções, na ordem em que precisam aparecer (G.5). */
export const SUMMARY_SECTIONS = [
  'Problema identificado',
  'Contexto',
  'Comportamento observado',
  'Tentativas já realizadas',
  'Impacto operacional',
  'Ação esperada',
] as const;

const ATTEMPTS = 3;
const RETRY_DELAY_MS = 800;
const ATTEMPT_TIMEOUT_MS = 25_000;

export interface TicketSummary {
  title: string;
  description: string;
  category: string;
  urgency: number;
  source: 'llm' | 'fallback' | 'test';
}

export interface TranscriptLine {
  role: 'user' | 'assistant';
  content: string;
}

/** Prompt de sistema: o texto do Anexo B mais o formato de saída e as categorias permitidas. */
export function buildSummarySystemPrompt(): string {
  return [
    SUMMARY_SYSTEM_PROMPT,
    'FORMATO DA RESPOSTA: responda somente com um objeto JSON com os campos "titulo", "descricao", "categoria" e "urgencia".',
    `VALORES PERMITIDOS PARA "categoria": ${TICKET_CATEGORIES.map((c) => `"${c}"`).join(', ')}.`,
  ].join('\n\n');
}

/** Mensagem do usuário ao modelo (Anexo B): setor, categoria travada e a transcrição. */
export function buildSummaryUserPrompt(input: {
  sector: string;
  cardCategory: string | null;
  transcript: readonly TranscriptLine[];
}): string {
  const lines = input.transcript.map(
    (line) => `${line.role === 'user' ? 'USUÁRIO' : 'BOT'}: ${line.content}`,
  );
  return [
    `Setor do usuário: ${input.sector}`,
    ...(input.cardCategory
      ? [
          `Categoria do atalho escolhido no início (troque se a conversa mostrar outro assunto): ${input.cardCategory}`,
        ]
      : []),
    '',
    'Transcrição da conversa (use APENAS para extrair os fatos — NÃO copie trechos, reescreva tudo como narrativa):',
    lines.join('\n\n'),
  ].join('\n');
}

const responseSchema = z.object({
  titulo: z.string(),
  descricao: z.string(),
  categoria: z.string().optional(),
  urgencia: z.unknown().optional(),
});

/** Quem pediu e onde, como o formulário informou: nunca vem da IA. */
export interface RequesterContext {
  requesterName: string;
  sector: string;
  /** Nulo quando a pessoa declarou não ter acesso à máquina. */
  machineIp: string | null;
}

/**
 * Põe nome, setor e IP no início da seção "Contexto" do resumo. Entram aqui, no servidor, para o
 * técnico vê-los no resumo sem que o nome e o IP sejam enviados ao provedor de IA; o setor já
 * faz parte do prompt do resumo (ADR-045).
 */
export function withRequesterContext(description: string, requester: RequesterContext): string {
  const ip = requester.machineIp ?? 'não informado, pessoa sem acesso à máquina';
  const line = `Solicitante: ${requester.requesterName}. Setor: ${requester.sector}. IP da máquina: ${ip}.`;
  return description.replace('Contexto:\n', () => `Contexto:\n${line}\n`);
}

/** Tira `#`, `*`, `_` e espaços das pontas de um título de seção ("### **Contexto:**" -> "Contexto:"). */
function cleanHeading(line: string): string {
  return line
    .replace(/[*_]/g, '')
    .replace(/^[\s#>-]+/, '')
    .trim();
}

/**
 * Confere as seis seções, na ordem, e devolve a descrição no formato canônico. Títulos com `#` ou
 * `**` são normalizados antes de validar (G.5); seção fora de ordem, repetida ou ausente é falha.
 */
export function normalizeDescription(raw: string): string | null {
  const lines = raw.replace(/\r\n/g, '\n').split('\n');
  const bodies: string[][] = [];
  let next = 0;

  for (const line of lines) {
    const heading = SUMMARY_SECTIONS[next];
    const cleaned = cleanHeading(line);
    if (heading && cleaned.toLowerCase().startsWith(`${heading.toLowerCase()}:`)) {
      bodies.push([cleaned.slice(heading.length + 1).trim()]);
      next += 1;
      continue;
    }
    // Um título conhecido fora do lugar estraga a ordem: falha em vez de aceitar.
    if (SUMMARY_SECTIONS.some((s) => cleaned.toLowerCase().startsWith(`${s.toLowerCase()}:`))) {
      return null;
    }
    bodies.at(-1)?.push(line);
  }
  if (next !== SUMMARY_SECTIONS.length) return null;

  const sections = SUMMARY_SECTIONS.map((name, index) => {
    const body = (bodies[index] ?? []).join('\n').trim();
    return body === '' ? null : `${name}:\n${body}`;
  });
  return sections.every((s) => s !== null) ? sections.join('\n\n') : null;
}

/** Valida a saída do modelo. Nulo conta como falha da tentativa. */
export function parseSummary(output: unknown, cardCategory: string | null): TicketSummary | null {
  const parsed = responseSchema.safeParse(output);
  if (!parsed.success) return null;

  const title = parsed.data.titulo.trim();
  // O título é pedido com até 80 caracteres; cortar depois esconderia o defeito (B-06).
  if (title === '' || title.length > TICKET_TITLE_MAX_LENGTH) return null;
  const description = normalizeDescription(parsed.data.descricao);
  if (description === null) return null;

  const urgencyValue = Number(parsed.data.urgencia);
  const urgency =
    Number.isInteger(urgencyValue) && urgencyValue >= URGENCY_MIN && urgencyValue <= URGENCY_MAX
      ? urgencyValue
      : DEFAULT_URGENCY;

  const suggested = parsed.data.categoria?.trim();
  const validSuggestion = TICKET_CATEGORIES.find((category) => category === suggested);
  return {
    title,
    description,
    urgency,
    // O atalho é só o ponto de partida: a conversa pode ter mudado de assunto (ADR-045).
    category: validSuggestion ?? cardCategory ?? DEFAULT_TICKET_CATEGORY,
    source: 'llm',
  };
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });

/**
 * Resume a conversa por IA, com até três tentativas (espera de `(tentativa-1) × 800 ms`, prazo de
 * 25 s cada). Devolve nulo se todas falharem, e o serviço usa a contingência.
 */
export async function summarizeWithLlm(input: {
  llm: LlmClient;
  sector: string;
  cardCategory: string | null;
  transcript: readonly TranscriptLine[];
  signal: AbortSignal;
  onFailure?: (attempt: number, error: unknown) => void;
}): Promise<TicketSummary | null> {
  const system = buildSummarySystemPrompt();
  const user = buildSummaryUserPrompt(input);

  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    if (input.signal.aborted) return null;
    if (attempt > 1) await sleep((attempt - 1) * RETRY_DELAY_MS, input.signal);

    try {
      const output = await input.llm.generateJson({
        system,
        user,
        signal: AbortSignal.any([input.signal, AbortSignal.timeout(ATTEMPT_TIMEOUT_MS)]),
      });
      const summary = parseSummary(output, input.cardCategory);
      if (summary) return summary;
      input.onFailure?.(attempt, new Error('Resumo fora do formato'));
    } catch (error) {
      input.onFailure?.(attempt, error);
      if (error instanceof LlmError && !error.retryable && error.kind !== 'unavailable')
        return null;
    }
  }
  return null;
}
