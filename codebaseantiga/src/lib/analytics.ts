// Lightweight client-side helpers for the Analytics dashboard.
// Heuristic theme classification + question normalization.

export type ThemeKey =
  | "senha"
  | "rede"
  | "impressora"
  | "sei"
  | "grp"
  | "hardware"
  | "acesso"
  | "outros";

export const THEME_LABELS: Record<ThemeKey, string> = {
  senha: "Senhas",
  rede: "Rede e internet",
  impressora: "Impressoras",
  sei: "SEI",
  grp: "Sistemas GRP Sonner",
  hardware: "Hardware",
  acesso: "Acesso a sistemas",
  outros: "Outros",
};

const THEME_RULES: Array<{ theme: ThemeKey; patterns: RegExp[] }> = [
  { theme: "senha", patterns: [/senha/i, /esqueci/i, /redefini/i, /n[aã]o consigo entrar/i, /bloqueado/i, /trocar a senha/i] },
  { theme: "rede", patterns: [/internet/i, /\brede\b/i, /\bwifi\b/i, /\bwi-?fi\b/i, /sem conex[aã]o/i, /lent[ao]/i, /sem net/i, /cabo de rede/i] },
  { theme: "impressora", patterns: [/impressora/i, /impress[aã]o/i, /imprimir/i, /repros?/i, /toner/i] },
  { theme: "sei", patterns: [/\bsei\b/i, /processo eletr[oô]nico/i] },
  { theme: "grp", patterns: [/sonner/i, /\bgrp\b/i, /folha de pagamento/i] },
  { theme: "hardware", patterns: [/computador/i, /monitor/i, /teclado/i, /mouse/i, /pc n[aã]o liga/i, /quebr/i, /pe[cç]a/i] },
  { theme: "acesso", patterns: [/acesso a/i, /sistema/i, /libera[cç][aã]o/i, /cadastrar/i, /usu[aá]rio/i, /perfil/i, /permiss[aã]o/i] },
];

export function classifyTheme(text: string): ThemeKey {
  if (!text) return "outros";
  for (const rule of THEME_RULES) {
    if (rule.patterns.some((p) => p.test(text))) return rule.theme;
  }
  return "outros";
}

/**
 * Loose normalization to group near-duplicate user questions:
 * lowercase, strip accents, trim, collapse whitespace, drop trailing punctuation.
 */
export function normalizeQuestion(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

export type Period = "today" | "7d" | "30d" | "90d" | "all";

export function periodToFromDate(period: Period): Date | null {
  const now = new Date();
  switch (period) {
    case "today": {
      const d = new Date(now);
      d.setHours(0, 0, 0, 0);
      return d;
    }
    case "7d":
      return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    case "30d":
      return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    case "90d":
      return new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    case "all":
    default:
      return null;
  }
}

export function dayKey(iso: string): string {
  // YYYY-MM-DD in local time
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function buildDateBuckets(from: Date | null, to: Date = new Date()): string[] {
  const start = from ?? new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
  const buckets: string[] = [];
  const cur = new Date(start);
  cur.setHours(0, 0, 0, 0);
  const end = new Date(to);
  end.setHours(0, 0, 0, 0);
  while (cur.getTime() <= end.getTime()) {
    buckets.push(dayKey(cur.toISOString()));
    cur.setDate(cur.getDate() + 1);
  }
  return buckets;
}
