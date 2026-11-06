import { convert, type HtmlToTextOptions } from 'html-to-text';

const MAX_LENGTH = 4000;
/** Passadas no máximo: cada uma desfaz uma camada de escape (`&lt;` -> `<` -> marca removida). */
const MAX_PASSES = 4;

const OPTIONS: HtmlToTextOptions = {
  wordwrap: false,
  preserveNewlines: true,
  selectors: [
    // Links e imagens viram só o texto: nada de endereço nem de atributo do GLPI chega à tela.
    { selector: 'a', options: { ignoreHref: true } },
    { selector: 'img', format: 'skip' },
    { selector: 'script', format: 'skip' },
    { selector: 'style', format: 'skip' },
  ],
};

/**
 * Converte o conteúdo de um chamado do GLPI em texto plano. O GLPI guarda o HTML com as marcas
 * escapadas (`&lt;p&gt;`), então cada passada decodifica as entidades e remove as marcas que
 * apareceram, até o texto parar de mudar. O resultado é sempre texto: a interface o desenha como
 * texto, nunca como HTML ou markdown (S-06).
 */
export function toPlainText(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let text = raw;
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const next = convert(text, OPTIONS);
    if (next === text) break;
    text = next;
  }
  text = text
    // Marcas de markdown que o próprio sistema põe no texto do chamado: saem como texto limpo.
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^-{3,}\s*$/gm, '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (text === '') return null;
  return text.length > MAX_LENGTH ? `${text.slice(0, MAX_LENGTH)}…` : text;
}

/**
 * Data do GLPI como ISO 8601. O GLPI manda "2026-03-02 12:00:00" sem fuso; é a hora do servidor
 * dele, em `America/Sao_Paulo` (UTC-3, sem horário de verão desde 2019).
 */
export function parseGlpiDate(value: string | null): string | null {
  if (!value) return null;
  const hasZone = /(Z|[+-]\d{2}:?\d{2})$/.test(value);
  const iso = hasZone ? value : `${value.replace(' ', 'T')}-03:00`;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
