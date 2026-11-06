/**
 * Detecção de chamados parecidos (G.6, RN-28 a RN-31), toda pura: o serviço busca os chamados e
 * esta parte só pontua. Reproduz os limiares do sistema anterior.
 */

export const PERSONAL_WINDOW_DAYS = 7;
export const PERSONAL_MAX_TICKETS = 30;
export const COLLECTIVE_WINDOW_HOURS = 2;
export const COLLECTIVE_MAX_TICKETS = 200;

const PERSONAL_THRESHOLD = 0.18;
const COLLECTIVE_THRESHOLD = 0.28;
const COLLECTIVE_MIN_USERS = 3;
const RECENT_BOOST_HOURS = 2;
const RECENT_BOOST = 0.15;
const SAME_CATEGORY_WINDOW_HOURS = 4;
const SAME_CATEGORY_MIN_SCORE = 0.55;
const MAX_SIMILAR = 3;
const CURRENT_TEXT_MAX_LENGTH = 4000;
const MIN_TOKEN_LENGTH = 3;

const HOUR_MS = 60 * 60 * 1000;

/** Palavras que não dizem nada sobre o problema (lista do sistema anterior). */
const STOPWORDS = new Set([
  'a',
  'o',
  'as',
  'os',
  'um',
  'uma',
  'uns',
  'umas',
  'de',
  'do',
  'da',
  'dos',
  'das',
  'em',
  'no',
  'na',
  'nos',
  'nas',
  'para',
  'por',
  'com',
  'sem',
  'que',
  'se',
  'ao',
  'aos',
  'e',
  'ou',
  'mas',
  'como',
  'ja',
  'muito',
  'esta',
  'este',
  'estou',
  'estamos',
  'sou',
  'somos',
  'ser',
  'tem',
  'temos',
  'ter',
  'foi',
  'fui',
  'era',
  'ele',
  'ela',
  'eles',
  'elas',
  'meu',
  'minha',
  'seu',
  'sua',
  'nos',
  'voces',
  'voce',
  'aqui',
  'ali',
  'la',
  'quando',
  'onde',
  'quem',
  'qual',
  'quais',
  'isso',
  'isto',
  'aquilo',
  'tudo',
  'nada',
  'sim',
  'nao',
  'so',
  'mais',
  'menos',
  'bem',
  'melhor',
  'pior',
  'tao',
  'entre',
  'sobre',
  'apos',
  'antes',
  'agora',
  'hoje',
  'ontem',
  'amanha',
  'ainda',
  'sempre',
  'nunca',
  'talvez',
  'preciso',
  'precisava',
  'queria',
  'quero',
  'gostaria',
  'favor',
  'obrigado',
  'obrigada',
  'oi',
  'ola',
  'bom',
  'boa',
  'dia',
  'tarde',
  'noite',
]);

/** Minúsculas, sem acento, só `[a-z0-9]`, com 3 ou mais caracteres e sem palavras vazias. */
export function tokenize(text: string): Set<string> {
  const normalized = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ');
  return new Set(
    normalized.split(' ').filter((word) => word.length >= MIN_TOKEN_LENGTH && !STOPWORDS.has(word)),
  );
}

/** Similaridade de Jaccard entre dois conjuntos: interseção sobre união. */
export function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;
  return shared / (a.size + b.size - shared);
}

export interface PastTicket {
  ticketId: string;
  userId: string;
  title: string;
  summary: string | null;
  category: string | null;
  createdAt: Date;
}

export interface CurrentCase {
  /** Categoria da conversa (a do card, se houver). */
  category: string | null;
  /** Falas do usuário nesta conversa. */
  userMessages: readonly string[];
}

export interface SimilarTicket {
  ticketId: string;
  title: string;
  category: string | null;
  ageMinutes: number;
  score: number;
}

function currentTokens(current: CurrentCase): Set<string> {
  const text = [current.category ?? '', ...current.userMessages].join(' ');
  return tokenize(text.slice(0, CURRENT_TEXT_MAX_LENGTH));
}

/**
 * Chamados anteriores do próprio usuário parecidos com a conversa atual: Jaccard acima de 0,18,
 * com bônus para os das últimas 2 h; e, na mesma categoria nas últimas 4 h, sempre (nota mínima
 * 0,55). No máximo 3, pela nota.
 */
export function findSimilarTickets(
  current: CurrentCase,
  past: readonly PastTicket[],
  now: Date,
): SimilarTicket[] {
  const text = currentTokens(current);
  const found: SimilarTicket[] = [];

  for (const ticket of past) {
    const ageMs = Math.max(0, now.getTime() - ticket.createdAt.getTime());
    const corpus = tokenize([ticket.title, ticket.summary ?? '', ticket.category ?? ''].join(' '));
    let score = jaccard(text, corpus);

    if (ageMs < RECENT_BOOST_HOURS * HOUR_MS) {
      score = Math.min(1, score + RECENT_BOOST * (1 - ageMs / (RECENT_BOOST_HOURS * HOUR_MS)));
    }
    const sameCategoryRecently =
      current.category !== null &&
      ticket.category === current.category &&
      ageMs <= SAME_CATEGORY_WINDOW_HOURS * HOUR_MS;
    if (sameCategoryRecently) score = Math.max(score, SAME_CATEGORY_MIN_SCORE);

    if (score >= PERSONAL_THRESHOLD || sameCategoryRecently) {
      found.push({
        ticketId: ticket.ticketId,
        title: ticket.title,
        category: ticket.category,
        ageMinutes: Math.floor(ageMs / 60_000),
        score,
      });
    }
  }

  return found.sort((a, b) => b.score - a.score).slice(0, MAX_SIMILAR);
}

export interface CollectiveIncident {
  count: number;
  category: string | null;
  windowHours: number;
}

/**
 * Incidente coletivo: relatos parecidos de **outras** pessoas nas últimas 2 h (título e categoria,
 * Jaccard de 0,28 ou mais) vindos de 3 ou mais usuários diferentes. Devolve só a contagem, nunca o
 * conteúdo dos chamados dos outros, que pode ter dado pessoal.
 */
export function detectCollectiveIncident(
  current: CurrentCase,
  recent: readonly PastTicket[],
  currentUserId: string,
  now: Date,
): CollectiveIncident | null {
  const text = currentTokens(current);
  const windowMs = COLLECTIVE_WINDOW_HOURS * HOUR_MS;
  const matching = recent.filter((ticket) => {
    if (ticket.userId === currentUserId) return false;
    if (now.getTime() - ticket.createdAt.getTime() > windowMs) return false;
    const corpus = tokenize(`${ticket.title} ${ticket.category ?? ''}`);
    return jaccard(text, corpus) >= COLLECTIVE_THRESHOLD;
  });

  const users = new Set(matching.map((ticket) => ticket.userId));
  if (users.size < COLLECTIVE_MIN_USERS) return null;
  return {
    count: matching.length,
    category: current.category,
    windowHours: COLLECTIVE_WINDOW_HOURS,
  };
}
