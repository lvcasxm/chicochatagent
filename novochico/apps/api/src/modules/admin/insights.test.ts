import { describe, expect, it } from 'vitest';
import { buildInsightsSample, INSIGHTS_MAX_CHARS } from './insights';

describe('buildInsightsSample', () => {
  it('monta título, setor e falas da pessoa', () => {
    const sample = buildInsightsSample([
      { title: 'Impressora', sector: 'Saúde', messages: ['não imprime', 'já reiniciei'] },
      { title: null, sector: null, messages: ['oi'] },
    ]);
    expect(sample.text).toBe(
      '(Impressora) [Saúde]\n- não imprime\n- já reiniciei\n\n(sem título) [setor não informado]\n- oi',
    );
    expect(sample).toMatchObject({ included: 2, truncated: false });
  });

  it('corta cada fala em 500 caracteres', () => {
    const sample = buildInsightsSample([{ title: 'a', sector: 'b', messages: ['x'.repeat(900)] }]);
    expect(sample.text).toContain(`${'x'.repeat(500)}…`);
    expect(sample.text).not.toContain('x'.repeat(501));
  });

  it('para no limite de tamanho e avisa que cortou', () => {
    const block = { title: 't', sector: 's', messages: ['y'.repeat(500)] };
    const sample = buildInsightsSample(Array.from({ length: 200 }, () => block));
    expect(sample.truncated).toBe(true);
    expect(sample.included).toBeLessThan(200);
    expect(sample.text.length).toBeLessThanOrEqual(INSIGHTS_MAX_CHARS);
  });

  it('lista vazia: nada incluído, sem aviso', () => {
    expect(buildInsightsSample([])).toEqual({ text: '', included: 0, truncated: false });
  });
});
