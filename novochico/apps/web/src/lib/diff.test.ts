import { describe, expect, it } from 'vitest';
import { collapseDiff, diffLines, hasChanges } from './diff';

describe('diffLines', () => {
  it('textos iguais não têm mudanças', () => {
    const lines = diffLines('a\nb\nc', 'a\nb\nc');
    expect(lines.map((l) => l.kind)).toEqual(['same', 'same', 'same']);
    expect(hasChanges(lines)).toBe(false);
  });

  it('marca linhas acrescentadas e removidas, mantendo a ordem', () => {
    const lines = diffLines('a\nb\nc', 'a\nx\nc\nd');
    expect(lines).toEqual([
      { kind: 'same', text: 'a' },
      { kind: 'added', text: 'x' },
      { kind: 'removed', text: 'b' },
      { kind: 'same', text: 'c' },
      { kind: 'added', text: 'd' },
    ]);
    expect(hasChanges(lines)).toBe(true);
  });

  it('o antes e o depois podem ser reconstruídos a partir do resultado', () => {
    const before = 'um\ndois\ntrês\nquatro\ncinco';
    const after = 'um\n2\ntrês\ncinco\nseis';
    const lines = diffLines(before, after);
    expect(
      lines
        .filter((l) => l.kind !== 'added')
        .map((l) => l.text)
        .join('\n'),
    ).toBe(before);
    expect(
      lines
        .filter((l) => l.kind !== 'removed')
        .map((l) => l.text)
        .join('\n'),
    ).toBe(after);
  });

  it('texto novo inteiro e texto apagado inteiro', () => {
    expect(diffLines('', 'a').some((l) => l.kind === 'added' && l.text === 'a')).toBe(true);
    expect(diffLines('a', '').some((l) => l.kind === 'removed' && l.text === 'a')).toBe(true);
  });

  it('documentos grandes (20.000 caracteres) são comparados sem travar', () => {
    const lines = Array.from({ length: 800 }, (_, i) => `linha ${i} com algum texto de exemplo`);
    const changed = lines.map((l, i) => (i % 40 === 0 ? `${l} (editada)` : l));
    const started = Date.now();
    const result = diffLines(lines.join('\n'), changed.join('\n'));
    expect(Date.now() - started).toBeLessThan(2000);
    expect(result.filter((l) => l.kind === 'added')).toHaveLength(20);
  });
});

describe('collapseDiff', () => {
  const same = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ kind: 'same' as const, text: `s${i}` }));

  it('mantém só o contexto em volta da mudança e conta o que escondeu', () => {
    const lines = [...same(10), { kind: 'added' as const, text: 'novo' }, ...same(10)];
    const items = collapseDiff(lines, 2);
    expect(items.map((item) => item.kind)).toEqual([
      'gap',
      'same',
      'same',
      'added',
      'same',
      'same',
      'gap',
    ]);
    expect(items[0]).toEqual({ kind: 'gap', count: 8 });
    expect(items.at(-1)).toEqual({ kind: 'gap', count: 8 });
  });

  it('mudanças próximas não deixam buraco entre elas', () => {
    const lines = [
      { kind: 'added' as const, text: 'a' },
      ...same(3),
      { kind: 'removed' as const, text: 'b' },
    ];
    expect(collapseDiff(lines, 2).some((item) => item.kind === 'gap')).toBe(false);
  });

  it('sem mudanças, tudo vira um buraco só; sem linhas, nada', () => {
    expect(collapseDiff(same(5))).toEqual([{ kind: 'gap', count: 5 }]);
    expect(collapseDiff([])).toEqual([]);
  });
});
