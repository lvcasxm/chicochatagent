// Utilitário simples para exportar arrays de objetos como CSV (UTF-8 com BOM p/ Excel-pt)

function escapeCsvValue(v: unknown): string {
  if (v === null || v === undefined) return "";
  let s: string;
  if (v instanceof Date) s = v.toISOString();
  else if (typeof v === "object") s = JSON.stringify(v);
  else s = String(v);
  // remove quebras internas problemáticas e escapa aspas
  s = s.replace(/\r?\n/g, " ").replace(/"/g, '""');
  if (/[",;\n]/.test(s)) s = `"${s}"`;
  return s;
}

export function toCsv<T extends Record<string, unknown>>(
  rows: T[],
  columns: { key: keyof T; header: string }[],
  separator: "," | ";" = ";",
): string {
  const head = columns.map((c) => escapeCsvValue(c.header)).join(separator);
  const body = rows
    .map((r) => columns.map((c) => escapeCsvValue(r[c.key])).join(separator))
    .join("\n");
  return `${head}\n${body}`;
}

export function downloadCsv(filename: string, csv: string) {
  // BOM p/ Excel detectar UTF-8 com acentos
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function timestampForFile(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
}
