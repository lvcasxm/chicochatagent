import type { ExportCell } from './repository';

/** Marca de ordem de bytes: o Excel só abre UTF-8 com acentos se ela estiver no início. */
export const CSV_BOM = '﻿';
export const CSV_SEPARATOR = ';';

/**
 * Uma planilha interpreta como fórmula o texto que começa com estes caracteres (injeção de
 * fórmula, S-15). Quem escreve o texto é o usuário, então ele é sempre tratado como dado.
 */
const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(value: ExportCell): string {
  if (value === null) return '';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'sim' : 'não';
  const text = value instanceof Date ? value.toISOString() : value;
  // Aspa simples na frente faz a planilha mostrar o texto e não calculá-lo.
  const safe = FORMULA_START.test(text) ? `'${text}` : text;
  return /[;"\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function csvLine(cells: ExportCell[]): string {
  return `${cells.map(csvCell).join(CSV_SEPARATOR)}\r\n`;
}
