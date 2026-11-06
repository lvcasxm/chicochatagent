import { describe, expect, it } from 'vitest';
import tokensCss from './tokens.css?raw';
import { contrast, parseTokens } from './contrast';

/**
 * As regras de contraste (ADR-025, WCAG 2.2 AA) calculadas sobre os tokens reais de `tokens.css`,
 * nos dois temas. Se alguém trocar uma cor, este teste diz se a combinação ainda é legível.
 */
const themes = parseTokens(tokensCss);

const TEXT = 4.5; // texto normal
const UI = 3; // ícones, bordas de controle e foco

/** [primeiro plano, fundo, mínimo, para que serve] */
const PAIRS: Array<[string, string, number, string]> = [
  ['fg', 'bg', TEXT, 'texto sobre o fundo'],
  ['fg', 'surface', TEXT, 'texto sobre a superfície'],
  ['fg', 'surface-hover', TEXT, 'texto no hover'],
  ['fg-muted', 'bg', TEXT, 'texto secundário sobre o fundo'],
  ['fg-muted', 'surface', TEXT, 'texto secundário sobre a superfície'],
  ['fg-muted', 'surface-hover', TEXT, 'texto secundário no hover e em controle desativado'],
  ['link', 'bg', TEXT, 'link'],
  ['accent-fg', 'accent', TEXT, 'texto sobre o botão azul'],
  ['accent-fg', 'accent-hover', TEXT, 'texto sobre o botão azul em hover'],
  ['fg', 'accent-soft', TEXT, 'texto em seleção suave'],
  ['danger', 'bg', TEXT, 'mensagem de erro'],
  ['danger', 'danger-soft', TEXT, 'ícone de erro no aviso'],
  ['fg', 'danger-soft', TEXT, 'texto no aviso de erro'],
  ['on-danger', 'danger', TEXT, 'texto no botão destrutivo'],
  ['warning', 'bg', TEXT, 'contingência'],
  ['warning', 'warning-soft', TEXT, 'ícone de contingência no aviso'],
  ['fg', 'warning-soft', TEXT, 'texto no aviso de contingência'],
  ['focus', 'bg', UI, 'contorno de foco'],
  ['focus', 'surface', UI, 'contorno de foco sobre a superfície'],
  ['border-strong', 'bg', UI, 'borda de campo (WCAG 1.4.11)'],
  ['border-strong', 'surface', UI, 'borda de campo sobre a superfície'],
  ['danger', 'bg', UI, 'borda de campo com erro'],
  ['warning', 'bg', UI, 'borda do aviso de contingência'],
];

describe.each(Object.entries(themes))('contraste no tema %s', (_theme, tokens) => {
  it.each(PAIRS)('%s sobre %s passa de %s:1 (%s)', (foreground, background, minimum) => {
    const fg = tokens[foreground];
    const bg = tokens[background];
    expect(fg, `token --${foreground}`).toBeDefined();
    expect(bg, `token --${background}`).toBeDefined();
    expect(contrast(fg!, bg!)).toBeGreaterThanOrEqual(minimum);
  });

  it('texto sobre o azul é sempre #111110, nunca branco (ADR-025)', () => {
    expect(tokens['accent']).toBe('#24bcec');
    expect(tokens['accent-fg']).toBe('#111110');
    // O motivo da regra: branco sobre o azul da marca reprova.
    expect(contrast('#fbfbfb', tokens['accent']!)).toBeLessThan(TEXT);
  });
});

describe('azul como texto', () => {
  it('só serve de link e de foco no tema escuro; no claro, o azul reprova sobre o fundo', () => {
    expect(contrast(themes['dark']['accent']!, themes['dark']['bg']!)).toBeGreaterThanOrEqual(TEXT);
    expect(contrast(themes['light']['accent']!, themes['light']['bg']!)).toBeLessThan(UI);
    expect(themes['light']['link']).toBe(themes['light']['fg']);
    expect(themes['light']['focus']).toBe(themes['light']['fg']);
  });
});

describe('tokens.css', () => {
  it('os dois temas definem os mesmos tokens', () => {
    expect(Object.keys(themes['dark']).sort()).toEqual(Object.keys(themes['light']).sort());
  });
});
