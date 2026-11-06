import { describe, expect, it } from 'vitest';
import { parseGlpiDate, toPlainText } from './plain-text';

describe('toPlainText', () => {
  it('converte o HTML escapado do GLPI em texto, decodificando antes de remover as marcas', () => {
    expect(toPlainText('&lt;p&gt;A impressora &lt;b&gt;parou&lt;/b&gt;.&lt;/p&gt;')).toBe(
      'A impressora parou.',
    );
  });

  it('converte HTML comum, com parágrafos e quebras', () => {
    expect(toPlainText('<p>Primeiro</p><p>Segundo<br>linha</p>')).toBe(
      'Primeiro\n\nSegundo\nlinha',
    );
  });

  it.each([
    ['imagem escapada com onerror', '&lt;img src=x onerror=alert(1)&gt;Olá'],
    ['imagem comum com onerror', '<img src=x onerror=alert(1)>Olá'],
    ['script escapado', '&lt;script&gt;alert(1)&lt;/script&gt;Olá'],
    ['script comum', '<script>alert(1)</script>Olá'],
    ['dupla codificação', '&amp;lt;img src=x onerror=alert(1)&amp;gt;Olá'],
    ['svg com onload', '<svg onload=alert(1)></svg>Olá'],
    ['estilo', '<style>body{display:none}</style>Olá'],
  ])('XSS: %s não deixa marca nem atributo no texto', (_name, input) => {
    const text = toPlainText(input) ?? '';
    expect(text).toBe('Olá');
    expect(text).not.toMatch(/[<>]|onerror|onload|alert/i);
  });

  it('links viram só o texto, sem o endereço', () => {
    expect(toPlainText('<a href="javascript:alert(1)">clique aqui</a>')).toBe('clique aqui');
    expect(toPlainText('<a href="https://x.test/segredo">portal</a>')).toBe('portal');
  });

  it('decodifica entidades comuns e preserva sinais que não são marcas', () => {
    expect(toPlainText('Tom &amp; Jerry &quot;ok&quot; &nbsp;fim')).toBe('Tom & Jerry "ok" fim');
    expect(toPlainText('se a &lt; b então c')).toBe('se a < b então c');
  });

  it('tira as marcas de markdown do próprio chamado, e o resto continua sendo só texto', () => {
    const entrada = ['**Solicitante:** Maria', '', '### Terceiro', '', '---', '', 'Texto'].join(
      '\n',
    );
    expect(toPlainText(entrada)).toBe('Solicitante: Maria\n\nTerceiro\n\nTexto');
    expect(toPlainText('use *asterisco* e [link](x)')).toBe('use *asterisco* e [link](x)');
  });

  it('vazio, nulo ou só marcas viram nulo', () => {
    expect(toPlainText(null)).toBeNull();
    expect(toPlainText('')).toBeNull();
    expect(toPlainText('<p> </p><br>')).toBeNull();
  });

  it('limita a 4000 caracteres', () => {
    const text = toPlainText('x'.repeat(5000)) ?? '';
    expect(text).toHaveLength(4001);
    expect(text.endsWith('…')).toBe(true);
  });
});

describe('parseGlpiDate', () => {
  it('data sem fuso é a hora de São Paulo (UTC-3)', () => {
    expect(parseGlpiDate('2026-03-02 12:00:00')).toBe('2026-03-02T15:00:00.000Z');
    expect(parseGlpiDate('2026-03-02T09:30:00')).toBe('2026-03-02T12:30:00.000Z');
  });

  it('data com fuso é respeitada', () => {
    expect(parseGlpiDate('2026-03-02T12:00:00Z')).toBe('2026-03-02T12:00:00.000Z');
    expect(parseGlpiDate('2026-03-02T12:00:00+00:00')).toBe('2026-03-02T12:00:00.000Z');
  });

  it('nula ou inválida vira nulo', () => {
    expect(parseGlpiDate(null)).toBeNull();
    expect(parseGlpiDate('ontem')).toBeNull();
  });
});
