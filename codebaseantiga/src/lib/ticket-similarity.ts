/**
 * Utilitários de normalização e similaridade textual usados pelo sistema
 * de prevenção de chamados duplicados.
 *
 * Mantemos a lógica de tokenização espelhada entre frontend e backend
 * (edge function ticket-duplicate-check) para facilitar testes e debug.
 */

const STOPWORDS = new Set<string>([
  "a","o","as","os","um","uma","uns","umas","de","do","da","dos","das","em","no","na","nos","nas",
  "para","por","com","sem","que","se","ao","aos","à","às","e","ou","mas","como","ja","já","muito",
  "esta","está","este","estou","estamos","sou","somos","ser","tem","temos","ter","foi","fui","era",
  "ele","ela","eles","elas","meu","minha","seu","sua","nos","nós","vocês","voce","você","aqui",
  "ali","la","lá","quando","onde","quem","qual","quais","isso","isto","aquilo","tudo","nada","sim",
  "não","nao","só","só","mais","menos","bem","melhor","pior","tao","tão","entre","sobre","apos",
  "após","antes","agora","hoje","ontem","amanha","amanhã","ainda","sempre","nunca","talvez","preciso","precisava",
  "queria","quero","gostaria","favor","obrigado","obrigada","oi","ola","olá","bom","boa","dia","tarde","noite",
]);

/** Normaliza texto removendo acentos, pontuação e caixa. */
export function normalizeText(input: string): string {
  return (input || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Tokeniza e remove stopwords e tokens muito curtos. */
export function tokenize(input: string): string[] {
  return normalizeText(input)
    .split(" ")
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

/**
 * Similaridade Jaccard entre dois textos.
 * Retorna 0..1. Não é perfeito, mas pega claramente duplicidades óbvias.
 */
export function similarityScore(a: string, b: string): number {
  const ta = new Set(tokenize(a));
  const tb = new Set(tokenize(b));
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  const union = ta.size + tb.size - inter;
  return union === 0 ? 0 : inter / union;
}

/** Atalho para exibir score como porcentagem inteira. */
export function scorePercent(score: number): number {
  return Math.round(Math.max(0, Math.min(1, score)) * 100);
}
