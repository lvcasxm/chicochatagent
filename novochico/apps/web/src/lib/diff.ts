export type DiffLine = { kind: 'same' | 'added' | 'removed'; text: string };

/**
 * Comparação linha a linha entre dois textos, para o administrador ver o que mudou entre a versão
 * publicada e o rascunho. Maior subsequência comum, sem dependências: os documentos têm no máximo
 * 20.000 caracteres.
 */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = before.split('\n');
  const b = after.split('\n');

  // Remove o começo e o fim iguais antes de montar a tabela: a maioria das edições é pequena.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1;
    endB -= 1;
  }

  const middleA = a.slice(start, endA);
  const middleB = b.slice(start, endB);
  const rows = middleA.length;
  const cols = middleB.length;
  const table: number[][] = Array.from({ length: rows + 1 }, () =>
    new Array<number>(cols + 1).fill(0),
  );
  for (let i = rows - 1; i >= 0; i -= 1) {
    for (let j = cols - 1; j >= 0; j -= 1) {
      table[i]![j] =
        middleA[i] === middleB[j]
          ? table[i + 1]![j + 1]! + 1
          : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    }
  }

  const result: DiffLine[] = a.slice(0, start).map((text) => ({ kind: 'same', text }));
  let i = 0;
  let j = 0;
  while (i < rows || j < cols) {
    if (i < rows && j < cols && middleA[i] === middleB[j]) {
      result.push({ kind: 'same', text: middleA[i]! });
      i += 1;
      j += 1;
    } else if (j < cols && (i === rows || table[i]![j + 1]! >= table[i + 1]![j]!)) {
      result.push({ kind: 'added', text: middleB[j]! });
      j += 1;
    } else {
      result.push({ kind: 'removed', text: middleA[i]! });
      i += 1;
    }
  }
  for (const text of a.slice(endA)) result.push({ kind: 'same', text });
  return result;
}

export function hasChanges(lines: DiffLine[]): boolean {
  return lines.some((line) => line.kind !== 'same');
}

export type DiffItem = DiffLine | { kind: 'gap'; count: number };

/**
 * Esconde os trechos longos sem mudança, deixando `context` linhas em volta de cada alteração:
 * num documento de 20.000 caracteres, quem confere uma mudança quer ver a mudança.
 */
export function collapseDiff(lines: DiffLine[], context = 2): DiffItem[] {
  const keep = new Array<boolean>(lines.length).fill(false);
  lines.forEach((line, index) => {
    if (line.kind === 'same') return;
    for (
      let near = Math.max(0, index - context);
      near <= Math.min(lines.length - 1, index + context);
      near += 1
    ) {
      keep[near] = true;
    }
  });

  const items: DiffItem[] = [];
  let hidden = 0;
  lines.forEach((line, index) => {
    if (keep[index]) {
      if (hidden > 0) items.push({ kind: 'gap', count: hidden });
      hidden = 0;
      items.push(line);
    } else {
      hidden += 1;
    }
  });
  if (hidden > 0) items.push({ kind: 'gap', count: hidden });
  return items;
}
